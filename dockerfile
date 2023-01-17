# Use an official Node.js runtime as the base image
FROM node:16

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the container
COPY package*.json ./

# Install ffmpeg
RUN apt update && apt upgrade
RUN apt install ffmpeg

# Install the app's dependencies
RUN npm install

# Copy the rest of the app's source code to the container
COPY . .

# Expose the app's port
EXPOSE 8080

# Start the app
CMD [ "npm", "start" ]