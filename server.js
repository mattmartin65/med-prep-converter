import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { processPDF } from './utils/pdfProcessor.js';
import debug from 'debug';

const log = debug('app:server');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Create required directories
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

try {
  [uploadDir, outputDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} catch (error) {
  log('Error creating directories:', error);
  process.exit(1);
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Serve static files
app.use('/uploads', express.static('uploads'));
app.use('/output', express.static('output'));

// Serve the upload form
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Medical PDF to CSV Converter</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .upload-form { border: 2px dashed #ccc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .submit-btn { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
          .file-input { margin-bottom: 20px; }
          .result { margin-top: 20px; padding: 15px; border-radius: 4px; }
          .success { background: #e8f5e9; color: #2e7d32; }
          .error { background: #ffebee; color: #c62828; }
        </style>
      </head>
      <body>
        <h1>Medical PDF to CSV Converter</h1>
        <div class="upload-form">
          <form action="/upload" method="post" enctype="multipart/form-data">
            <div class="file-input">
              <input type="file" name="pdf" accept=".pdf" required>
            </div>
            <button type="submit" class="submit-btn">Upload and Convert</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// Handle file upload and processing
app.post('/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const inputPath = req.file.path;
  const outputPath = path.join(outputDir, `${path.parse(req.file.originalname).name}.csv`);

  try {
    const result = await processPDF(inputPath, outputPath);
    
    if (result.success) {
      res.send(`
        <html>
          <head>
            <title>Conversion Success</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
              .result { margin-top: 20px; padding: 15px; border-radius: 4px; }
              .success { background: #e8f5e9; color: #2e7d32; }
              .download-btn { background: #1976d2; color: white; padding: 10px 20px; border: none; border-radius: 4px; text-decoration: none; display: inline-block; margin-top: 15px; }
            </style>
          </head>
          <body>
            <div class="result success">
              <h2>Conversion Successful!</h2>
              <p>Your PDF has been converted to CSV format.</p>
              <a href="/output/${path.basename(outputPath)}" class="download-btn" download>Download CSV</a>
              <br><br>
              <a href="/" style="color: #1976d2;">Convert another file</a>
            </div>
          </body>
        </html>
      `);
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    log('Error processing upload:', error);
    res.status(500).send(`
      <html>
        <head>
          <title>Conversion Error</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .result { margin-top: 20px; padding: 15px; border-radius: 4px; }
            .error { background: #ffebee; color: #c62828; }
          </style>
        </head>
        <body>
          <div class="result error">
            <h2>Error During Conversion</h2>
            <p>${error.message}</p>
            <a href="/" style="color: #1976d2;">Try again</a>
          </div>
        </body>
      </html>
    `);
  } finally {
    // Clean up uploaded file
    try {
      await fs.promises.unlink(inputPath);
    } catch (error) {
      log('Error cleaning up uploaded file:', error);
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  log('Error:', err);
  res.status(500).send(`
    <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .error { background: #ffebee; color: #c62828; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>Application Error</h2>
          <p>${err.message}</p>
          <a href="/" style="color: #1976d2;">Return to home</a>
        </div>
      </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});