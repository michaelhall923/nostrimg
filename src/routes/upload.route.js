const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const AWS = require("aws-sdk");
const sharp = require("sharp");

const router = express.Router();

const MAX_FILE_SIZE = 10; // Max file size in MB

/// Set up multer to handle file uploads using memory storage
const storage = multer.memoryStorage();

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
  let isAuthenticated = req.session.isAuthenticated;

  if (!isAuthenticated) {
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
        .jpeg({ quality: 70 })
        .toBuffer();
    } else if (req.file.mimetype == "image/png") {
      req.file.buffer = await sharp(req.file.buffer)
        .rotate()
        .png({ quality: 90 })
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
      // Set up the S3 client
      const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });

      // Generate a random 8 character 64-bit string for the filename
      const fileID = crypto.randomBytes(4).toString("hex");
      const fileName = fileID + path.extname(req.file.originalname);

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
      if (process.env.NODE_ENV == "development") {
        url = "http://nostrimg.com/";
      }

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

module.exports = router;
