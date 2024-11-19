import PDFParser from 'pdf-parse';
import { createObjectCsvWriter } from 'csv-writer';
import natural from 'natural';
import fs from 'fs/promises';
import debug from 'debug';

const log = debug('app:pdf-processor');
const tokenizer = new natural.WordTokenizer();

const categories = {
  MEDICATION: ['medication', 'iron', 'supplements', 'antidiarrheals', 'blood', 'tablets', 'aspirin'],
  BOWELPREP: ['plenvu', 'glycoprep', 'moviprep', 'picolax', 'picoprep', 'prepkit', 'dose', 'sachet'],
  DIET: ['diet', 'food', 'eat', 'drink', 'fluids', 'breakfast', 'lunch', 'dinner', 'meals'],
  PROCEDURE: ['procedure', 'colonoscopy', 'hospital', 'appointment', 'admission']
};

function extractOffset(text) {
  const dayPatterns = [
    /(\d+)\s*days?\s*(?:before|prior)/i,
    /day\s*(-?\d+)/i,
    /(\d+)\s*days?\s*ahead/i
  ];

  for (const pattern of dayPatterns) {
    const match = text.match(pattern);
    if (match) {
      const days = parseInt(match[1]);
      return days > 0 ? -days : days;
    }
  }

  if (text.toLowerCase().includes('day of procedure') || 
      text.toLowerCase().includes('day of colonoscopy')) {
    return 0;
  }

  return -1;
}

async function determineCategory(text) {
  try {
    const tokens = tokenizer.tokenize(text.toLowerCase());
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => text.toLowerCase().includes(keyword))) {
        return category.toLowerCase();
      }
    }
    return 'procedure';
  } catch (error) {
    log('Error determining category:', error);
    return 'procedure';
  }
}

async function extractTimeFromText(text) {
  try {
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
  } catch (error) {
    log('Error extracting time:', error);
    return null;
  }
}

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim();
}

export async function processPDF(inputPath, outputPath) {
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
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

  try {
    const data = await fs.readFile(inputPath);
    const pdf = await PDFParser(data, {
      max: 0,
      version: 'v2.0.550',
      pagerender: render_page
    });
    
    const instructions = [];
    let currentPrep = '';
    let order = 1;
    
    const lines = pdf.text.split('\n')
      .map(cleanText)
      .filter(line => line.length > 0 && !line.match(/^\s*page\s+\d+\s*$/i));
    
    let isProcedureMorning = false;
    let isSplit = false;

    // First pass to determine procedure time and split dose
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('morning') && lowerLine.includes('procedure')) {
        isProcedureMorning = true;
      }
      if (lowerLine.includes('split')) {
        isSplit = true;
      }
    }
    
    for (const line of lines) {
      if (line.toLowerCase().includes('prep')) {
        const prepMatch = line.match(/\b(plenvu|glycoprep|moviprep|picolax|picoprep|prepkit)\b/i);
        if (prepMatch) {
          currentPrep = prepMatch[0].toLowerCase();
        }
      }
      
      const instruction = {
        bowelprep: currentPrep || 'plenvu', // Default to plenvu for this specific PDF
        order: order++,
        category: await determineCategory(line),
        message: line.trim(),
        offset: extractOffset(line),
        time: await extractTimeFromText(line),
        split: isSplit,
        procedure_time: isProcedureMorning ? 'morning' : 'afternoon'
      };
      
      instructions.push(instruction);
    }
    
    await csvWriter.writeRecords(instructions);
    return { success: true, message: 'CSV file has been created successfully' };
    
  } catch (error) {
    log('Error processing PDF:', error);
    return { 
      success: false, 
      message: `Error processing PDF: ${error.message}`
    };
  }
}

function render_page(pageData) {
  let render_options = {
    normalizeWhitespace: true,
    disableCombineTextItems: false
  };
  return pageData.getTextContent(render_options)
    .then(function(textContent) {
      let lastY, text = '';
      for (let item of textContent.items) {
        if (lastY == item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      return text;
    });
}