const fs = require('fs');
const path = require('path');

const previewPath = path.join(__dirname, 'preview.html');
const componentsDir = path.join(__dirname, 'src', 'components');

const content = fs.readFileSync(previewPath, 'utf8');

const componentsToExtract = [
    'AdminConfigPanel',
    'ApiConfigPanel',
    'AIUsageLogs',
    'RAGManagerPanel',
    'FacilityDashboard',
    'RevenueOverviewDashboard',
    'KPISettings',
    'ArchivedFacilitiesDashboard',
    'DailyReport'
];

function extractComponent(name) {
    const regex = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*{`, 'g');
    const match = regex.exec(content);
    if (!match) {
        console.log(`Could not find ${name}`);
        return;
    }
    
    let startIndex = match.index;
    let braceCount = 0;
    let endIndex = startIndex;
    let inString = false;
    let stringChar = '';
    
    // Find the first opening brace
    while (content[endIndex] !== '{' && endIndex < content.length) {
        endIndex++;
    }
    
    if (endIndex >= content.length) return;
    
    braceCount = 1;
    endIndex++;
    
    while (braceCount > 0 && endIndex < content.length) {
        const char = content[endIndex];
        
        if (inString) {
            if (char === stringChar && content[endIndex - 1] !== '\\') {
                inString = false;
            }
        } else {
            if (char === '"' || char === "'" || char === '\`') {
                inString = true;
                stringChar = char;
            } else if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
            }
        }
        endIndex++;
    }
    
    const componentCode = content.substring(startIndex, endIndex);
    
    // Write to file
    const fileContent = `import React, { useState, useEffect, useRef } from 'react';\n\nexport default ${componentCode}\n`;
    fs.writeFileSync(path.join(componentsDir, `${name}.jsx`), fileContent);
    console.log(`Successfully extracted ${name}.jsx`);
}

componentsToExtract.forEach(extractComponent);
