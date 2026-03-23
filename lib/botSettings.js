const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../botSettings.json");

// Load settings
function loadSettings() {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(filePath));
}

// Save settings
function saveSettings(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = { loadSettings, saveSettings };