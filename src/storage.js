const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(fileName, value) {
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadDataset() {
  return {
    plant: readJson("plant.json"),
    jobs: readJson("jobs.json"),
    scenarios: readJson("scenarios.json"),
    feedback: readJson("feedback.json")
  };
}

module.exports = {
  readJson,
  writeJson,
  loadDataset
};
