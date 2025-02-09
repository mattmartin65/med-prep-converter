import PDFParser from 'pdf-parse';
import { createObjectCsvWriter } from 'csv-writer';
import natural from 'natural';
import fs from 'fs/promises';

const tokenizer = new natural.WordTokenizer();

const csvWriter = createObjectCsvWriter({
  path: 'output.csv',
  header: [
    { id: 'bowelprep', title: 'bowelprep' },
    { id: 'order', title: 'order' },
    { id: 'category', title: 'category' },
    { id: 'message', title: 'message' },
    { id: 'offset', title: 'offset' },
    { id: 'time', title: 'time' },
    { id: 'split', title: 'split' },
    { id: 'procedure_time', title: 'procedure_time' }
  ]
});

const categories = {
  MEDICATION: ['medication', 'iron', 'supplements', 'antidiarrheals'],
  BOWELPREP: ['plenvu', 'glycoprep', 'moviprep', 'picolax', 'picoprep', 'prepkit'],
  DIET: ['diet', 'food', 'eat', 'drink', 'fluids'],
  PROCEDURE: ['procedure', 'colonoscopy']
};

async function determineCategory(text) {
  const tokens = tokenizer.tokenize(text.toLowerCase());
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => tokens.includes(keyword))) {
      return category.toLowerCase();
    }
  }
  return 'procedure';
}

async function extractTimeFromText(text) {
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const match = text.match(timeRegex);
  
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const period = match[3]?.toLowerCase();

    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    return hours + minutes/60;
  }
  return null;
}

async function processPDF(filePath) {
  try {
    const data = await fs.readFile(filePath);
    const pdf = await PDFParser(data);
    
    const instructions = [];
    let currentPrep = '';
    let order = 1;
    
    // Split PDF content into lines and process each instruction
    const lines = pdf.text.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      if (line.toLowerCase().includes('prep')) {
        currentPrep = line.match(/\b(plenvu|glycoprep|moviprep|picolax|picoprep|prepkit)\b/i)?.[0].toLowerCase() || currentPrep;
      }
      
      const instruction = {
        bowelprep: currentPrep,
        order: order++,
        category: await determineCategory(line),
        message: line.trim(),
        offset: -1, // Default offset, adjust based on context
        time: await extractTimeFromText(line) || null,
        split: line.toLowerCase().includes('split'),
        procedure_time: line.toLowerCase().includes('morning') ? 'morning' : 'afternoon'
      };
      
      instructions.push(instruction);
    }
    
    await csvWriter.writeRecords(instructions);
    console.log('CSV file has been created successfully');
    
  } catch (error) {
    console.error('Error processing PDF:', error);
  }
}

// Usage
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Please provide a PDF file path');
  process.exit(1);
}

processPDF(pdfPath);