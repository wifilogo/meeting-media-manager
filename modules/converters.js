// Internal modules
const { notifyUser } = require("./log");
const { get } = require("./store");

// External modules
const dayjs = require("dayjs");
const path = require("upath");
const $ = require("jquery");
const fs = require("fs-extra");
const glob = require("fast-glob");

dayjs.extend(require("dayjs/plugin/isoWeek"));
dayjs.extend(require("dayjs/plugin/isBetween"));
dayjs.extend(require("dayjs/plugin/isSameOrBefore"));
dayjs.extend(require("dayjs/plugin/customParseFormat"));
dayjs.extend(require("dayjs/plugin/duration"));

// Variables
const fullHd = [1920, 1080];
const now = dayjs().hour(0).minute(0).second(0).millisecond(0);


async function mp4Convert(perf, updateStatus, updateTile, progressSet, createVideoSync, totals, mediaPath) {
  const prefs = get("prefs");
  perf("mp4Convert", "start");
  updateStatus("file-video");
  updateTile("mp4Convert", "warning");
  
  let filesToProcess = glob.sync(path.join(mediaPath, "*"), {
    onlyDirectories: true
  }).map(folderPath => path
    .basename(folderPath))
    .filter(folder => 
      dayjs(
        folder, 
        prefs.outputFolderDateFormat
      ).isValid() && 
      dayjs(folder, prefs.outputFolderDateFormat)
        .isBetween(get("baseDate"), get("baseDate").clone().add(6, "days"), null, "[]") && 
        now.isSameOrBefore(dayjs(folder, prefs.outputFolderDateFormat))
    )
    .map(folder => glob.sync(path.join(mediaPath, folder, "*"), {
      ignore: ["!**/(*.mp4|*.xspf)"]
    })).flat();
  totals.mp4Convert = {
    total: filesToProcess.length,
    current: 1
  };
  
  progressSet(totals.mp4Convert.current, totals.mp4Convert.total, "mp4Convert");
  
  for (let mediaFile of filesToProcess) {
    await createVideoSync(mediaFile);
    totals.mp4Convert.current++;
    progressSet(totals.mp4Convert.current, totals.mp4Convert.total, "mp4Convert");
  }

  updateTile("mp4Convert", "success");
  perf("mp4Convert", "stop");
}

function convertPdf(mediaFile, rm) {
  return new Promise((resolve)=>{
    let pdfjsLib = require("pdfjs-dist/build/pdf.js");
    pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry.js");
    pdfjsLib.getDocument({
      url: mediaFile,
      verbosity: 0
    }).promise.then(async function(pdf) {
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        await convertPdfPage(mediaFile, pdf, pageNum, notifyUser);
      }
      await rm(mediaFile);
    }).catch((err) => {
      notifyUser("warn", "warnPdfConversionFailure", path.basename(mediaFile), true, err);
    }).then(() => {
      resolve();
    });
  });
}

function convertPdfPage(mediaFile, pdf, pageNum) {
  return new Promise((resolve)=>{
    pdf.getPage(pageNum).then(function(page) {
      $("body").append("<div id='pdf' style='display: none;'>");
      $("div#pdf").append("<canvas id='pdfCanvas'></canvas>");
      let scale = fullHd[1] / page.getViewport({scale: 1}).height * 2;
      let canvas = $("#pdfCanvas")[0];
      let ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      canvas.height = fullHd[1] * 2;
      canvas.width = page.getViewport({scale: scale}).width;
      page.render({
        canvasContext: ctx,
        viewport: page.getViewport({scale: scale})
      }).promise.then(function() {
        fs.writeFileSync(
          path.join(path.dirname(mediaFile), path.basename(mediaFile, path.extname(mediaFile)) + "-" + String(pageNum).padStart(2, "0") + ".png"), 
          Buffer.from(canvas.toDataURL().replace(/^data:image\/\w+;base64,/, ""), "base64")
        );
        $("div#pdf").remove();
      }).catch((err) => {
        notifyUser("warn", "warnPdfConversionFailure", path.basename(mediaFile), true, err);
      }).finally(() => {
        resolve();
      });
    });
  });
}

function convertSvg(mediaFile, rm) {
  return new Promise((resolve)=>{
    $("body").append("<div id='svg'>");
    $("div#svg").append("<img id='svgImg'>").append("<canvas id='svgCanvas'></canvas>");
    $("img#svgImg").on("load", function() {
      let canvas = $("#svgCanvas")[0];
      let image = $("img#svgImg")[0];
      
      image.height = fullHd[1] * 2;
      canvas.height = image.height;
      canvas.width  = image.width;
      
      let canvasContext = canvas.getContext("2d");
      canvasContext.fillStyle = "white";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      canvasContext.imageSmoothingEnabled = true;
      canvasContext.imageSmoothingQuality = "high";
      canvasContext.drawImage(image, 0, 0);
      
      fs.writeFileSync(
        path.join(path.dirname(mediaFile), path.basename(mediaFile, path.extname(mediaFile)) + ".png"), 
        Buffer.from(canvas.toDataURL().replace(/^data:image\/\w+;base64,/, ""), "base64")
      );
      rm(mediaFile);
      $("div#svg").remove();
      return resolve();
    });

    $("img#svgImg").on("error", function() {
      notifyUser("warn", "warnSvgConversionFailure", path.basename(mediaFile), true);
      return resolve();
    });

    $("img#svgImg").prop("src", escape(mediaFile));
  });
}

async function convertUnusableFiles(rm, p) {
  for (let pdfFile of glob.sync(path.join(p, "**", "*pdf"), {
    ignore: [path.join(p, "Recurring")]
  })) {
    await convertPdf(pdfFile, rm);
  }
  for (let svgFile of glob.sync(path.join(p, "**", "*svg"), {
    ignore: [path.join(p, "Recurring")]
  })) {
    await convertSvg(svgFile, rm);
  }
}

module.exports = {
  mp4Convert,
  convertUnusableFiles,
};
