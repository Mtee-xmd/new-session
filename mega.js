
const mega = require('megajs');

// SECURE WAY: Use environment variables for credentials
const auth = {
  email: process.env.MEGA_EMAIL || 'manyakaontiretse@gmail.com',
  password: process.env.MEGA_PASSWORD || 'macoder200',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

async function uploadToMega(filePath, fileName) {
  return new Promise((resolve, reject) => {
    const storage = new mega.Storage(auth, (err) => {
      if (err) return reject(err);

      const uploadOptions = {
        name: fileName,
        allowUploadBuffering: true
      };

      const upload = storage.upload(filePath, uploadOptions);
      
      upload.on('complete', (file) => {
        file.link((err, url) => {
          if (err) return reject(err);
          storage.close();
          resolve(url);
        });
      });

      upload.on('error', (err) => {
        storage.close();
        reject(err);
      });
    });
  });
}

// Example usage
async function main() {
  try {
    const fileUrl = await uploadToMega('./example.txt', 'uploaded_file.txt');
    console.log('File uploaded successfully:', fileUrl);
  } catch (error) {
    console.error('Upload failed:', error);
  }
}

// Uncomment to run
// main();

module.exports = { uploadToMega };