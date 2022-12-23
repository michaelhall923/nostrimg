const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const AWS = require("aws-sdk");

if (process.env.NODE_ENV == "development") {
  require("dotenv").config();
}

const PORT = process.env.PORT || 3001;

const app = express();

const MAX_FILE_SIZE = 5;

/// Set up multer to handle file uploads
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * MAX_FILE_SIZE, // Limit file size to 5 MB
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp)$/)) {
      return cb(
        new Error(
          "Invalid file type. Please upload a file in one of the following formats: jpeg, jpg, png, or webp."
        )
      );
    }

    cb(null, true);
  },
});

const uploadSingleImage = upload.single("image");

app.post("/api/upload", async (req, res) => {
  await uploadSingleImage(req, res, async function (err) {
    if (err) {
      if (err.code == "LIMIT_FILE_SIZE")
        err.message = `The file you are trying to upload is too large. Please choose a file with a size less than ${MAX_FILE_SIZE}MB and try again.`;
      return res.status(400).send({ message: err.message });
    }

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

      // Return the fileName to the client
      res.send({
        url: `https://i.nostrimg.com/${fileName}`,
        fileName: fileName,
        fileID: fileID,
        message: "Image uploaded successfully.",
      });
    } catch (err) {
      // Handle errors
      console.error(err);
      res.status(500).send({ message: err.message });
    }
  });
});

app.listen(8000, () => {
  console.log("Server listening on port 8000");
});

app.get("/api", (req, res) => {
  res.json({ message: "Hello from server!" });
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
