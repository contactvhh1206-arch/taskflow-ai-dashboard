const fs = require('fs');
const content = fs.readFileSync('preview.html', 'utf8');

// Find the code inside DailyCheckin
const start = content.indexOf('function DailyCheckin(');
const end = content.indexOf('// --- COMPONENT LOGIN ---');

if (start !== -1 && end !== -1) {
    const code = content.substring(start, end);
    fs.writeFileSync('scratch/checkin.jsx', "const React = require('react'); const { useState, useEffect, useContext } = React; const AuthContext = {};\n" + code);
    console.log("Wrote code to checkin.jsx");
} else {
    console.log("Could not find bounds");
}
