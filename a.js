/* ==========================================================================
   A5 PLATFORM - FRONTEND ENGINE & PARSING CONTROLLER
   ========================================================================== */

let activeFile = null;
let extractedFileText = "";
let currentOutputs = {};
let activeTabKey = null;

// Initialize Drag & Drop Handlers
document.addEventListener("DOMContentLoaded", () => {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) {
      handleFileSelection(e.target.files[0]);
    }
  });
});

// Process Selected File (Client-side PDF & DOCX Extraction)
async function handleFileSelection(file) {
  activeFile = file;
  document.getElementById("fileName").innerText = file.name;
  document.getElementById("fileInfo").classList.remove("hidden");

  const ext = file.name.split('.').pop().toLowerCase();

  try {
    if (ext === "pdf") {
      extractedFileText = await extractPdfText(file);
    } else if (ext === "docx") {
      extractedFileText = await extractDocxText(file);
    } else if (ext === "txt") {
      extractedFileText = await file.text();
    } else if (["png", "jpg", "jpeg", "mp3", "wav", "m4a"].includes(ext)) {
      // Images & Audio are passed directly as base64 to A5 backend pipeline
      extractedFileText = await fileToBase64(file);
    }
  } catch (err) {
    alert("Error parsing file: " + err.message);
  }
}

function clearFile() {
  activeFile = null;
  extractedFileText = "";
  document.getElementById("fileInput").value = "";
  document.getElementById("fileInfo").classList.add("hidden");
}

// Client-side PDF Text Extraction via PDF.js
function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function() {
      try {
        const typedarray = new Uint8Array(this.result);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(" ") + "\n";
        }
        resolve(text);
      } catch (e) { reject(e); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Client-side DOCX Extraction via Mammoth.js
function extractDocxText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      mammoth.extractRawText({ arrayBuffer: e.target.result })
        .then(result => resolve(result.value))
        .catch(err => reject(err));
    };
    reader.readAsArrayBuffer(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Execute A5 Transformation Request
async function executeTransformation() {
  const sourceText = document.getElementById("sourceText").value.trim();
  const customPrompt = document.getElementById("customPrompt").value.trim();
  const audience = document.getElementById("paramAudience").value;
  const tone = document.getElementById("paramTone").value;
  const language = document.getElementById("paramLanguage").value;

  const checkboxes = document.querySelectorAll(".deliverables-grid input[type='checkbox']:checked");
  const selectedOutputs = Array.from(checkboxes).map(cb => cb.value);

  if (!sourceText && !extractedFileText) {
    alert("Please provide raw text or upload a document/file.");
    return;
  }

  if (selectedOutputs.length === 0) {
    alert("Please select at least one target deliverable format.");
    return;
  }

  // UI Processing State
  const btn = document.getElementById("btnTransform");
  btn.disabled = true;
  btn.querySelector(".btn-text").innerText = "Transforming Content...";
  btn.querySelector(".btn-spinner").classList.remove("hidden");

  const payload = {
    source_text: sourceText,
    extracted_file_data: extractedFileText,
    file_type: activeFile ? activeFile.name.split('.').pop().toLowerCase() : 'text',
    custom_prompt: customPrompt,
    audience: audience,
    tone: tone,
    language: language,
    output_types: selectedOutputs
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status === "success" && data.outputs) {
      currentOutputs = data.outputs;
      renderOutputTabs();
    } else {
      alert("Transformation Error: " + (data.message || "Failed to generate outputs."));
    }
  } catch (err) {
    alert("Network or Server Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-text").innerText = "Execute A5 Transformation";
    btn.querySelector(".btn-spinner").classList.add("hidden");
  }
}

// Render Output Station Tabs
function renderOutputTabs() {
  const tabStrip = document.getElementById("outputTabs");
  tabStrip.innerHTML = "";
  
  const keys = Object.keys(currentOutputs);
  if (keys.length === 0) return;

  document.getElementById("tabActions").classList.remove("hidden");

  keys.forEach((key, index) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${index === 0 ? 'active' : ''}`;
    btn.innerText = key.replace('_', ' ').toUpperCase();
    btn.onclick = () => switchTab(key, btn);
    tabStrip.appendChild(btn);
  });

  switchTab(keys[0], tabStrip.children[0]);
}

function switchTab(key, btnElement) {
  activeTabKey = key;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");

  const rawMarkdown = currentOutputs[key] || "";
  document.getElementById("outputCanvas").innerHTML = marked.parse(rawMarkdown);
}

// Export Station Actions
function copyActiveTab() {
  if (!activeTabKey || !currentOutputs[activeTabKey]) return;
  navigator.clipboard.writeText(currentOutputs[activeTabKey]);
  alert("Copied deliverable text to clipboard!");
}

function exportActiveTabTxt() {
  if (!activeTabKey || !currentOutputs[activeTabKey]) return;
  const element = document.createElement("a");
  const file = new Blob([currentOutputs[activeTabKey]], {type: 'text/plain'});
  element.href = URL.createObjectURL(file);
  element.download = `A5_${activeTabKey}_Deliverable.txt`;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function exportActiveTabPdf() {
  if (!activeTabKey || !currentOutputs[activeTabKey]) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const text = currentOutputs[activeTabKey];
  const splitText = doc.splitTextToSize(text, 180);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  let y = 15;
  splitText.forEach(line => {
    if (y > 280) {
      doc.addPage();
      y = 15;
    }
    doc.text(line, 15, y);
    y += 6;
  });

  doc.save(`A5_${activeTabKey}_Deliverable.pdf`);
}
