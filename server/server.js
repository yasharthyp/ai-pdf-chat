const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdf = require("pdf-parse");

const app = express();

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },

  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    console.log(req.file);
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No PDF uploaded",
      });
    }

    const filePath = req.file.path;

    const dataBuffer = fs.readFileSync(filePath);

const pdfData = await pdf(dataBuffer);

    res.json({
      success: true,
      text: pdfData.text,
    });
  }catch (error) {
  console.error(error);

  res.status(500).json({
    success: false,
    error: error.message,
  });
}
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});