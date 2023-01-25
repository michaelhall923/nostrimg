const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const axios = require("axios");
const AWS = require("aws-sdk");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const { randomFileID } = require("../utils/file");
const { isAuthenticated } = require("../utils/auth");

const router = express.Router();

const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE_MB; // Max file size in MB

/// Set up multer to handle file uploads using memory storage
const storage = multer.memoryStorage();

// Set up the S3 client
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Upload filters, etc.
const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    // Allow image files and GIFs
    if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
      return cb(
        new Error(
          "Invalid file type. Please upload a file in one of the following formats: jpeg, jpg, png, gif, or webp."
        )
      );
    }

    cb(null, true);
  },
});

const uploadSingleImage = upload.single("image");

// Upload image route
router.post("/upload", async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.status(401).send({
      session: req.session,
    });
  }

  await uploadSingleImage(req, res, async function (err) {
    if (err) {
      if (err.code == "LIMIT_FILE_SIZE")
        err.message = `The file you are trying to upload is too large. Please choose a file with a size less than ${MAX_FILE_SIZE}MB and try again.`;
      return res.status(400).send({ message: err.message });
    }

    // Compress the image using Sharp
    if (req.file.mimetype == "image/jpeg" || req.file.mimetype == "image/jpg") {
      req.file.buffer = await sharp(req.file.buffer)
        .rotate()
        .jpeg({ mozjpeg: true })
        .toBuffer();
    } else if (req.file.mimetype == "image/png") {
      req.file.buffer = await sharp(req.file.buffer)
        .rotate()
        .png({ quality: 10 })
        .toBuffer();
    } else if (req.file.mimetype == "image/webp") {
      req.file.buffer = await sharp(req.file.buffer, { animated: true })
        .rotate()
        .webp({ quality: 80 })
        .toBuffer();
    } else if (req.file.mimetype == "image/gif") {
      req.file.buffer = await sharp(req.file.buffer, { animated: true })
        .rotate()
        .gif({ quality: 80 })
        .toBuffer();
    }

    // Send to S3
    try {
      // Generate a random 8 character 64-bit string for the filename
      const fileID = randomFileID();
      const fileName =
        fileID + path.extname(req.file.originalname).toLowerCase();

      // Upload the file to the S3 bucket
      const s3Response = await s3
        .putObject({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: fileName,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
        .promise();

      // Return the file data to the client
      var url = "https://nostrimg.com/";
      var imageUrl = "https://i.nostrimg.com/";

      req.session.totalUploads++;

      return res.send({
        route: `/i/${fileName}`,
        url: `${url}i/${fileName}`,
        imageUrl: `${imageUrl}${fileName}`,
        fileName: fileName,
        fileID: fileID,
        message: "Image uploaded successfully.",
        lightningDestination: process.env.BTC_PAY_SERVER_LNURL,
        lightningPaymentLink: `lightning:${process.env.BTC_PAY_SERVER_LNURL}`,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).send({ message: err.message });
    }
  });
});

router.get("/upload/tinify", async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.status(401).send({
      session: req.session,
    });
  }

  const fileName = crypto.randomBytes(16).toString("base64").replace(/\//, "_");
  const response = await axios.get(req.query.imageUrl, {
    responseType: "stream",
  });
  const stream = response.data.pipe(
    fs.createWriteStream(`./tmp/uploads/${fileName}`)
  );

  stream.on("finish", async () => {
    const file = await sharp(process.cwd() + `/tmp/uploads/${fileName}`, {
      animated: true,
    });
    const metadata = await file.metadata();

    const smallerDim = 128;
    const scale =
      metadata.width > metadata.pageHeight
        ? `-2:${smallerDim}`
        : `${smallerDim}:-2`;

    ffmpeg(`./tmp/uploads/${fileName}`)
      .outputOption(
        "-vf",
        `minterpolate='fps=20',scale=${scale}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:reserve_transparent=0[p];[s1][p]paletteuse`
      )
      .output(`./tmp/uploads/${fileName}.gif`)
      .on("end", async function () {
        fs.unlinkSync(`./tmp/uploads/${fileName}`); // delete the temporary file

        const gifPath = `./tmp/uploads/${fileName}.gif`;

        // Send to S3
        try {
          // Generate a random 8 character 64-bit string for the filename
          const fileID = randomFileID();
          const fileName = fileID + path.extname(gifPath);

          // Upload the file to the S3 bucket
          const s3Response = await s3
            .putObject({
              Bucket: process.env.AWS_S3_BUCKET,
              Key: fileName,
              Body: fs.readFileSync(gifPath),
              ContentType: "image/gif",
            })
            .promise();

          fs.unlinkSync(gifPath); // delete the temporary file

          // Return the file data to the client
          var url = "https://nostrimg.com/";
          var imageUrl = "https://i.nostrimg.com/";

          req.session.totalUploads++;

          return res.send({
            route: `/i/${fileName}`,
            url: `${url}i/${fileName}`,
            imageUrl: `${imageUrl}${fileName}`,
            fileName: fileName,
            fileID: fileID,
            message: "Image uploaded successfully.",
            lightningDestination: process.env.BTC_PAY_SERVER_LNURL,
            lightningPaymentLink: `lightning:${process.env.BTC_PAY_SERVER_LNURL}`,
          });
        } catch (err) {
          console.error(err);
          return res.status(500).send({ message: err.message });
        }
      })
      .on("error", function (err, stdout, stderr) {
        console.error(err);
        return res.status(500).send({ message: err.message });
      })
      .run();
  });
});

// Upload filters, etc.
const gififySingleVideo = multer({
  dest: "./tmp/uploads",
  limits: {
    fileSize: 1024 * 1024 * MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    // Allow image files and GIFs
    if (!file.mimetype.match(/^video\/(mp4|webm|avi|mov|quicktime)$/)) {
      return cb(
        new Error(
          `Invalid file type (${file.mimetype}). Please upload a file in one of the following formats: mp4, webm, avi, mov, or quicktime`
        )
      );
    }

    cb(null, true);
  },
}).single("video");

// Upload image route
router.post("/upload/gifify", async (req, res) => {
  let isAuthenticated = req.session.isAuthenticated;

  if (process.env.NODE_ENV == "development") {
    isAuthenticated = true;
  }

  if (!isAuthenticated) {
    return res.status(401).send({
      session: req.session,
    });
  }

  await gififySingleVideo(req, res, async function (err) {
    if (err) {
      if (err.code == "LIMIT_FILE_SIZE")
        err.message = `The file you are trying to upload is too large. Please choose a file with a size less than ${MAX_FILE_SIZE}MB and try again.`;
      return res.status(400).send({ message: err.message });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).send("Invalid video file");
    }

    const crop = JSON.parse(req.body.crop);

    ffmpeg(req.file.path)
      .output(`${req.file.path}.gif`)
      .duration(req.body.length)
      .outputOptions([
        "-filter_complex",
        `fps=15,scale=480:-1:flags=lanczos,crop=in_w*${crop.width}:in_h*${crop.height}:in_w*${crop.x}:in_h*${crop.y},split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer`,
      ])
      .on("end", async function () {
        // console.log("conversion finished!");
        fs.unlinkSync(req.file.path); // delete the temporary file

        const gifPath = `${req.file.path}.gif`;

        // Send to S3
        try {
          // Generate a random 8 character 64-bit string for the filename
          const fileID = randomFileID();
          const fileName = fileID + path.extname(gifPath);

          // Upload the file to the S3 bucket
          const s3Response = await s3
            .putObject({
              Bucket: process.env.AWS_S3_BUCKET,
              Key: fileName,
              Body: fs.readFileSync(gifPath),
              ContentType: "image/gif",
            })
            .promise();

          fs.unlinkSync(gifPath); // delete the temporary file

          // Return the file data to the client
          var url = "https://nostrimg.com/";
          var imageUrl = "https://i.nostrimg.com/";

          return res.send({
            route: `/i/${fileName}`,
            url: `${url}i/${fileName}`,
            imageUrl: `${imageUrl}${fileName}`,
            fileName: fileName,
            fileID: fileID,
            message: "Image uploaded successfully.",
            lightningDestination: process.env.BTC_PAY_SERVER_LNURL,
            lightningPaymentLink: `lightning:${process.env.BTC_PAY_SERVER_LNURL}`,
          });
        } catch (err) {
          console.error(err);
          return res.status(500).send({ message: err.message });
        }
      })
      .on("error", function (err, stdout, stderr) {
        // console.log("ffmpeg stdout:\n" + stdout);
        // console.log("ffmpeg stderr:\n" + stderr);
        console.error(err);
        return res.status(500).send({ message: err.message });
      })
      .run();
  });
});

module.exports = router;
