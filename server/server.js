require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { v1: DocumentAI } = require("@google-cloud/documentai");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 5000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DOC_AI_PROJECT_ID = process.env.DOC_AI_PROJECT_ID;
const DOC_AI_LOCATION = process.env.DOC_AI_LOCATION || "us";
const DOC_AI_PROCESSOR_ID = process.env.DOC_AI_PROCESSOR_ID;
const DOC_AI_CREDENTIALS_JSON = process.env.DOC_AI_CREDENTIALS_JSON;
const OCR_TEXT_THRESHOLD = Number(process.env.OCR_TEXT_THRESHOLD || 200);

if (!GEMINI_API_KEY) {
  throw new Error(
    "Missing Gemini API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in environment variables."
  );
}

if (!GROQ_API_KEY) {
  throw new Error("Missing GROQ_API_KEY in environment variables.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

const isDocAIConfigured = Boolean(DOC_AI_PROJECT_ID && DOC_AI_PROCESSOR_ID);
let docAIClient = null;

if (isDocAIConfigured) {
  const clientOptions = {};

  if (DOC_AI_CREDENTIALS_JSON) {
    try {
      clientOptions.credentials = JSON.parse(DOC_AI_CREDENTIALS_JSON);
    } catch (error) {
      throw new Error("DOC_AI_CREDENTIALS_JSON is not valid JSON.");
    }
  }

  docAIClient = new DocumentAI.DocumentProcessorServiceClient(clientOptions);
}

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
});

let vectorStore = [];

function isInvalidGeminiKeyError(error) {
  if (error?.errorDetails?.some((detail) => detail?.reason === "API_KEY_INVALID")) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return message.includes("api_key_invalid") || message.includes("api key not valid");
}

async function createEmbedding(text) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    if (isInvalidGeminiKeyError(error)) {
      const authError = new Error(
        "Gemini API key is invalid. Generate a new key in Google AI Studio and set GEMINI_API_KEY in Render/local env."
      );
      authError.statusCode = 401;
      throw authError;
    }

    throw error;
  }
}

function mergeExtractedText(parsedText, ocrText) {
  const safeParsedText = String(parsedText || "").trim();
  const safeOcrText = String(ocrText || "").trim();

  if (!safeParsedText) {
    return safeOcrText;
  }

  if (!safeOcrText) {
    return safeParsedText;
  }

  if (safeParsedText.includes(safeOcrText)) {
    return safeParsedText;
  }

  if (safeOcrText.includes(safeParsedText)) {
    return safeOcrText;
  }

  return `${safeParsedText}\n\n${safeOcrText}`;
}

async function extractTextWithDocumentAI(pdfBuffer) {
  if (!docAIClient) {
    return "";
  }

  const processorPath = `projects/${DOC_AI_PROJECT_ID}/locations/${DOC_AI_LOCATION}/processors/${DOC_AI_PROCESSOR_ID}`;

  try {
    const [result] = await docAIClient.processDocument({
      name: processorPath,
      rawDocument: {
        content: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
      },
    });

    return String(result?.document?.text || "").trim();
  } catch (error) {
    console.error("Document AI OCR failed", error?.message || error);
    return "";
  }
}

function chunkText(text, chunkSize = 1000) {
  const chunks = [];

  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  return chunks;
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

app.get("/", (req, res) => {
  res.send("Backend Running");
});

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    console.log(`Upload received: ${req.file?.originalname || "unknown file"}`);
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No PDF uploaded",
      });
    }

    const dataBuffer = req.file.buffer;

    const parser = new PDFParse({ data: dataBuffer });
    const pdfData = await parser.getText();
    const parsedText = String(pdfData?.text || "").trim();

    let ocrText = "";
    if (parsedText.length < OCR_TEXT_THRESHOLD) {
      ocrText = await extractTextWithDocumentAI(dataBuffer);
    }

    const fullText = mergeExtractedText(parsedText, ocrText);

    if (!fullText) {
      return res.status(422).json({
        success: false,
        message:
          "Could not extract readable text from this PDF. For scanned files, configure Document AI OCR env vars.",
      });
    }

    const chunks = chunkText(fullText).filter((chunk) => chunk.trim().length > 0);

    vectorStore = [];

    for (const chunk of chunks) {
      const embedding = await createEmbedding(chunk);

      vectorStore.push({
        text: chunk,
        embedding,
      });
    }

    res.json({
      success: true,
      totalChunks: vectorStore.length,
      extraction: {
        parsedTextLength: parsedText.length,
        ocrUsed: Boolean(ocrText),
        ocrTextLength: ocrText.length,
      },
    });
  } catch (error) {
    console.error(error);

    const statusCode = error?.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      });
    }

    const questionEmbedding = await createEmbedding(question);

    const scoredChunks = vectorStore.map((item) => ({
      text: item.text,
      score: cosineSimilarity(questionEmbedding, item.embedding),
    }));

    scoredChunks.sort((a, b) => b.score - a.score);

    const topChunks = scoredChunks.slice(0, 3);

    const context = topChunks.map((item) => item.text).join("\n");

    const message = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Answer only from provided context. If answer is not found, say you don't know.",
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion:\n${question}`,
        },
      ],
      model: "llama-3.3-70b-versatile",
    });

    res.json({
      success: true,
      answer: message.choices[0].message.content,
      context: topChunks,
    });
  } catch (error) {
    console.error(error);

    const statusCode = error?.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});