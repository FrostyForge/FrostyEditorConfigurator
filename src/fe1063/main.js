import mappings from "./mappings.json" with { type: "json" };

const proxyUrl = "https://github-asset-proxy.adamraichu.workers.dev/?url=";

//#region Helpers

function createSection(name = "devNoName") {
  const div = document.createElement("div");
  div.className = "section";
  const label = document.createElement("h3");
  label.innerText = name;
  div.appendChild(label);
  return div;
}

function createItem(name, description, enabledByDefault, readonly = false, expanded = true) {
  const itemDiv = document.createElement("details");
  itemDiv.className = "item";
  itemDiv.open = expanded;
  itemDiv.dataset["name"] = name;
  const title = document.createElement("summary");
  title.textContent = name;
  const desc = document.createElement("p");
  desc.textContent = description;
  const checkboxGuid = crypto.randomUUID();
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = enabledByDefault;
  checkbox.disabled = readonly;
  checkbox.id = checkboxGuid;
  checkbox.name = checkboxGuid;
  const checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = checkboxGuid;
  checkboxLabel.textContent = "Enabled";
  itemDiv.appendChild(title);
  itemDiv.appendChild(desc);
  itemDiv.appendChild(checkbox);
  itemDiv.appendChild(checkboxLabel);
  return itemDiv;
}

const statusSpan = document.getElementById("status");
function setStatus(status) {
  statusSpan.innerText = status;
}

//#endregion

// Top level editor section first.
const editorSection = createSection("Frosty Editor");
editorSection.appendChild(createItem(mappings.editor.main[0].name, mappings.editor.main[0].description, true, true));

const container = document.getElementById("configuration");
container.appendChild(editorSection);

// Then other sections.
const pluginSection = createSection("Plugins");
container.appendChild(pluginSection);
const pluginElements = [];
mappings.editor.plugins.forEach(plugin => {
  const item = createItem(plugin.name, plugin.description, true, false, true);
  pluginSection.appendChild(item);
  pluginElements.push(item);
});

const otherFilesSection = createSection("Misc Files");
container.appendChild(otherFilesSection);
const otherFilesElements = [];
mappings.editor.other.forEach(otherFileMapping => {
  const item = createItem(otherFileMapping.name, otherFileMapping.description, true, false, true);
  otherFilesSection.appendChild(item);
  otherFilesElements.push(item);
});

document.getElementById("scroll").addEventListener("click", () => {
  document.getElementById("execute").scrollIntoView({ behavior: "smooth" });
});

//#region onExecute
const executeButton = document.getElementById("execute");
executeButton.addEventListener("click", async () => {
  executeButton.disabled = true;
  executeButton.innerText = "Downloading...";

  const enabledPlugins = [];
  pluginElements.forEach(item => {
    const checkbox = item.querySelector("input[type='checkbox']");
    if (checkbox.checked) {
      enabledPlugins.push(item.dataset["name"]);
    }
  });
  console.log("Enabled plugins:", enabledPlugins);

  const enabledOtherFiles = [];
  otherFilesElements.forEach(item => {
    const checkbox = item.querySelector("input[type='checkbox']");
    if (checkbox.checked) {
      enabledOtherFiles.push(item.dataset["name"]);
    }
  });

  setStatus("[Step 1/3] Downloading FrostyEditor.zip (0%)");

  const updateProgress = (received, total) => {
    const percent = Math.round((received / total) * 100);
    setStatus(`[Step 1/3] Downloading FrostyEditor.zip (${percent}%)`);
  };

  /**
   * Fetch with progress
   * @param {string} url 
   */
  async function fetchWithProgress(url) {
    const response = await fetch(url);
    const contentLength = response.headers.get("Content-Length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!total) {
      console.warn("Content-Length not found, progress will not be shown.");
      return response.blob();
    }

    let loaded = 0;
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.byteLength;
          updateProgress(loaded, total);
          controller.enqueue(value);
        }
        controller.close();
      }
    });

    return new Response(stream).blob();
  }

  const dataBlob = await fetchWithProgress(proxyUrl + mappings.editor.main[0].url);
  const zip = await JSZip.loadAsync(dataBlob, {});
  console.log({ before: zip.files });

  setStatus("[Step 2/3] Downloading selected files.");

  const rootFolderObject = zip.folder("FrostyEditor/");

  /**
   * @type {Promise<Blob>[]}
   */
  const blobPromises = [];
  const filenames = [];
  /* 
  const exampleDependency = {
    category: "plugins",
    index: 1
  };
  const exampleDependency2 = {
    category: "hidden",
    index: 0
  };
  */
  let requiredDependencies = [];

  // Plugins
  mappings.editor.plugins.forEach((pluginMapping) => {
    if (enabledPlugins.includes(pluginMapping.name)) {
      blobPromises.push(new Promise(async (res, _rej) => {
        res((await fetch(proxyUrl + pluginMapping.url)).blob());
      }));
      filenames.push(pluginMapping.filename);
      requiredDependencies.push(...pluginMapping.dependencies);
    }
  });

  // Other files
  mappings.editor.other.forEach((otherFileMapping) => {
    if (enabledOtherFiles.includes(otherFileMapping.name)) {
      blobPromises.push(new Promise(async (res, _rej) => {
        res((await fetch(proxyUrl + otherFileMapping.url)).blob());
      }));
      filenames.push(otherFileMapping.filename);
      requiredDependencies.push(...otherFileMapping.dependencies);
    }
  });

  // Dependencies
  let hasFulfilledAllDependencies = false;
  while (!hasFulfilledAllDependencies) {
    const newDependencies = [];
    requiredDependencies.forEach(dependency => {
      const mapping = mappings.editor[dependency.category][dependency.index];
      blobPromises.push(new Promise(async (res, _rej) => {
        res((await fetch(proxyUrl + mapping.url)).blob());
      }));
      newDependencies.push(...mapping.dependencies);
      filenames.push(mapping.filename);
    });
    requiredDependencies = newDependencies;
    if (requiredDependencies.length === 0) {
      hasFulfilledAllDependencies = true;
    }
    console.log("Dependency loop");
  }

  const resolvedBlobs = await Promise.all(blobPromises);
  for (var i = 0; i < resolvedBlobs.length; i++) {
    rootFolderObject.file(filenames[i], resolvedBlobs[i], { binary: true, createFolders: true });
  }

  console.log({ after: zip.files });
  setStatus("[Step 3/3] Generating file for download.");

  zip.generateAsync({ type: "blob" }, (meta) => {
    setStatus(`Generating file for download... ${meta.percent.toFixed(2)}%`);
  })
    .then(function (content) {
      saveAs(content, "FrostyEditor-1.0.6.3-Customized.zip");
      setStatus("Download complete.");
      executeButton.disabled = false;
      executeButton.innerText = "Download again for some reason?";
    });

});
//#endregion