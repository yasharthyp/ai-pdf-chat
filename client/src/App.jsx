import { useState } from "react";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://ai-pdf-chat-backend.onrender.com";

export default function App() {
  const [pdf, setPdf] = useState(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "ai",
      text: "Hello 👋 Upload a PDF and ask questions.",
    },
  ]);

  const uploadPDF = async () => {
    if (!pdf) {
      alert("Please select PDF");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", pdf, pdf.name);

    try {
      await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: "PDF uploaded successfully ✅",
        },
      ]);
    } catch (error) {
      console.error(error);

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message =
          error.response?.data?.message ||
          error.response?.data?.error ||
          error.message;

        alert(`Upload failed (${status ?? "unknown"}): ${message}`);
        return;
      }

      alert("Upload failed");
    }
  };

  const askQuestion = async () => {
    if (!question) return;

    const userQuestion = question;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: userQuestion,
      },
    ]);

    setQuestion("");

    try {
      const response = await axios.post(
        `${API_BASE_URL}/chat`,
        {
          question: userQuestion,
        }
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: response.data.answer,
        },
      ]);
    } catch (error) {
      console.error(error);

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: "Something went wrong",
        },
      ]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 min-h-[85vh]">

            {/* Sidebar */}
            <div className="bg-black text-white p-6">
              <h1 className="text-3xl font-bold mb-2">
                AI PDF Chat
              </h1>

              <p className="text-gray-400 mb-8">
                Upload PDF and ask questions using AI
              </p>

              <div className="border border-dashed border-gray-600 rounded-2xl p-6 text-center">
                <div className="text-5xl mb-4">
                  📄
                </div>

                <p className="font-semibold mb-4">
                  Upload PDF
                </p>

                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) =>
                    setPdf(e.target.files[0])
                  }
                  className="mb-4"
                />

                <button
                  onClick={uploadPDF}
                  className="bg-white text-black px-4 py-2 rounded-xl"
                >
                  Upload
                </button>
              </div>
            </div>

            {/* Chat Section */}
            <div className="md:col-span-2 flex flex-col bg-white">

              {/* Header */}
              <div className="border-b p-5">
                <h2 className="text-2xl font-bold">
                  PDF Assistant
                </h2>

                <p className="text-gray-500">
                  Ask questions from uploaded PDF
                </p>
              </div>

              {/* Messages */}
              <div className="flex-1 p-6 bg-gray-50 overflow-y-auto space-y-4">

                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={
                      msg.role === "user"
                        ? "flex justify-end"
                        : "flex justify-start"
                    }
                  >
                    <div
                      className={
                        msg.role === "user"
                          ? "bg-black text-white p-4 rounded-2xl max-w-xl"
                          : "bg-white p-4 rounded-2xl shadow-sm max-w-xl"
                      }
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}

              </div>

              {/* Input */}
              <div className="border-t p-5">
                <div className="flex gap-4">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) =>
                      setQuestion(e.target.value)
                    }
                    placeholder="Ask question..."
                    className="flex-1 border rounded-2xl px-5 py-4"
                  />

                  <button
                    onClick={askQuestion}
                    className="bg-black text-white px-6 rounded-2xl"
                  >
                    Send
                  </button>
                </div>
              </div>

            </div>

          </div>
        </div>
      </div>
    </div>
  );
}