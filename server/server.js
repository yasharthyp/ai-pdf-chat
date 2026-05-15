require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 5000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
});

let vectorStore = [];

async function createEmbedding(text) {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent(text);
  return result.embedding.values;
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
    console.log(req.file);
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No PDF uploaded",
      });
    }

    const dataBuffer = req.file.buffer;

    const parser = new PDFParse({ data: dataBuffer });
    const pdfData = await parser.getText();

    const chunks = chunkText(pdfData.text);

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
    });
  }catch (error) {
  console.error(error);

  res.status(500).json({
    success: false,
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

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});