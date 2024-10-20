import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { RekognitionClient, DetectLabelsCommand } from "@aws-sdk/client-rekognition";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

// AWS Clients
const s3 = new S3Client({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  }
});

const rekognition = new RekognitionClient({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  }
});

const dynamoDb = new DynamoDBClient({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  }
});

function App() {
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [match, setMatch] = useState(null);  // Match result
  const [detectedLabels, setDetectedLabels] = useState([]);  // Store Rekognition labels
  const [adminMode, setAdminMode] = useState(false);  // Admin mode toggle
  const [newItem, setNewItem] = useState({ name: '', location: '', description: '', image: null });
  const [matchedItemDetails, setMatchedItemDetails] = useState(null);  // Matched item details
  const [isCameraActive, setIsCameraActive] = useState(false);  // Control camera activation
  const [isAdminCamera, setIsAdminCamera] = useState(false);    // Determine if admin or user camera
  const [capturedFromCamera, setCapturedFromCamera] = useState(false); // Track if image captured from camera

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);

  // Effect to stop the camera stream when component unmounts
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  // Effect to start the camera after the video element is rendered
  useEffect(() => {
    if (isCameraActive && videoRef.current) {
      startCamera();
    }
  }, [isCameraActive]);

  // Function to handle starting the camera
  const startCamera = async () => {
    try {
      const constraints = {
        video: { facingMode: { exact: 'environment' } }  // Try to use back camera first
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play();
        setStream(mediaStream);
      } else {
        console.error("Video element not found.");
      }
    } catch (err) {
      console.error("Error accessing the back camera, trying front camera: ", err);
      fallbackToFrontCamera();
    }
  };

  // Function to fallback to front camera if back camera is unavailable
  const fallbackToFrontCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true }); // Use any available camera
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play();
        setStream(mediaStream);
      } else {
        console.error("Video element not found.");
      }
    } catch (fallbackErr) {
      console.error("Error accessing the front camera as fallback: ", fallbackErr);
    }
  };

  // Function to stop the camera
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraActive(false);
  };

  // Function to capture image (used for both user and admin)
  const captureImage = () => {
    if (!videoRef.current) return;

    const context = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    
    context.drawImage(videoRef.current, 0, 0, videoRef.current.videoWidth, videoRef.current.videoHeight);
    const capturedImage = canvasRef.current.toDataURL('image/jpeg');  // Ensure correct format

    if (isAdminCamera) {
      setNewItem({ ...newItem, image: capturedImage });
    } else {
      setImage(capturedImage);
      setCapturedFromCamera(true);  // Track that the image was captured from the camera
    }

    stopCamera();
  };

  // Function to submit the captured image (acts like uploading the image)
  const submitCapturedImage = async () => {
    console.log("Region:", process.env.REACT_APP_AWS_REGION);
console.log("Access Key:", process.env.REACT_APP_AWS_ACCESS_KEY_ID);

    setLoading(true);  // Show "Processing..."
    setMatch(null);    // Reset previous match result
    setDetectedLabels([]);  // Clear previous labels
  
    try {
      // Convert dataURL to a blob (image from camera)
      const response = await fetch(image);
      const blob = await response.blob();
  
      // Create a file from the blob
      const file = new File([blob], "captured-image.jpg", { type: "image/jpeg" });
  
      // 1. Upload the captured image to S3
      await uploadUserImageToS3(file);
  
      // 2. Start comparison with admin images
      const matchFound = await compareWithAllAdminImages(file);
  
      // 3. Detect labels in the uploaded image
      const userLabels = await detectLabelsInImage(`user-uploads/${file.name}`);
      setDetectedLabels(userLabels);
  
      // 4. Handle match result
      if (!matchFound) {
        alert("No match found.");  // Show "No match found" if there's no match
      }
    } catch (error) {
      console.error("Error processing image:", error);
      alert("An error occurred while processing the image.");
    } finally {
      setLoading(false);  // Hide "Processing..." when done
    }
  };
  

  // Retake the captured image (reset the state and start the camera again)
  const retakeImage = () => {
    setImage(null);  // Clear the captured image
    setCapturedFromCamera(false);  // Reset the capturedFromCamera state
    setIsCameraActive(true);  // Restart the camera
  };

  // Function to handle image upload for the user
  const handleUserFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      alert('Only JPEG and PNG images are supported');
      return;
    }

    setLoading(true);  // Start showing "Processing"
    setImage(null);    // Clear previous image if any
    setMatch(null);    // Reset previous match result if any
    setDetectedLabels([]);  // Clear previous labels

    try {
      // 1. Upload the user's image to S3
      await uploadUserImageToS3(file);

      // 2. Start comparison with all admin images
      const matchFound = await compareWithAllAdminImages(file);

      // 3. Detect labels in the uploaded user image
      const userLabels = await detectLabelsInImage(`user-uploads/${file.name}`);
      setDetectedLabels(userLabels);

      // 4. Handle match or no match results
      if (matchFound) {
        setImage(URL.createObjectURL(file));  // Set image if a match is found
      } else {
        alert("No match found.");  // Notify if no match is found
      }
    } catch (error) {
      console.error("Error processing image:", error);
      alert("An error occurred while processing the image.");
    } finally {
      setLoading(false);  // Hide the processing screen after all operations are done
    }
  };

  // Helper function to upload user's image to S3
  const uploadUserImageToS3 = async (file) => {
    try {
      const uploadParams = {
        Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
        Key: `user-uploads/${file.name}`,
        Body: file,
        ContentType: file.type
      };
      const command = new PutObjectCommand(uploadParams);
      await s3.send(command);
      console.log(`Uploaded user image: ${file.name}`);
    } catch (error) {
      console.error("Error uploading image to S3: ", error);
    }
  };

  // Handle admin file upload
  const handleAdminFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setNewItem({ ...newItem, image: URL.createObjectURL(file) });
    await uploadAdminImageToS3(file);
  };

  // Helper function to upload admin's image to S3 and store metadata in DynamoDB
  const uploadAdminImageToS3 = async (file) => {
    setLoading(true);
    try {
      const uploadParams = {
        Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
        Key: `admin/${file.name}`,  // Store admin image in the admin folder
        Body: file,
        ContentType: file.type
      };
      const command = new PutObjectCommand(uploadParams);
      await s3.send(command);

      // Store item metadata in DynamoDB
      const imageUrl = `https://${process.env.REACT_APP_AWS_BUCKET_NAME}.s3.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/admin/${file.name}`;
      const itemParams = {
        TableName: "LostItems",
        Item: {
          "ItemID": { S: file.name },
          "Name": { S: newItem.name },
          "Location": { S: newItem.location },
          "Description": { S: newItem.description },
          "ImageUrl": { S: imageUrl }
        }
      };
      const dbCommand = new PutItemCommand(itemParams);
      await dynamoDb.send(dbCommand);

      alert("Item added successfully!");
    } catch (error) {
      console.error("Error uploading image and saving item data: ", error);
    }
    setLoading(false);
  };

  // Function to compare user image with admin images
  const compareWithAllAdminImages = async (file) => {
    let matchFound = false;
    try {
      const listParams = {
        Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
        Prefix: 'admin/'  // Only list objects in the admin folder
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const response = await s3.send(listCommand);

      if (response.Contents && response.Contents.length > 0) {
        for (const adminImage of response.Contents) {
          const adminImageKey = adminImage.Key;

          // Detect labels in the admin image
          const adminLabels = await detectLabelsInImage(adminImageKey);

          // Detect labels in the user-uploaded image
          const userLabels = await detectLabelsInImage(`user-uploads/${file.name}`);

          // Compare labels between user and admin images
          if (compareLabels(userLabels, adminLabels)) {
            console.log("Labels match with:", adminImageKey);
            await fetchMatchedItemDetails(adminImageKey);
            matchFound = true;
            break;
          }
        }
      } else {
        console.log("No images found in the admin folder.");
        setMatch(false);
      }
    } catch (error) {
      console.error("Error comparing images:", error);
    }
    return matchFound;
  };

  // Function to detect labels in images using Rekognition
  const detectLabelsInImage = async (imageKey) => {
    const detectParams = {
      Image: {
        S3Object: {
          Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
          Name: imageKey
        }
      },
      MaxLabels: 3,
      MinConfidence: 70
    };

    try {
      const command = new DetectLabelsCommand(detectParams);
      const response = await rekognition.send(command);
      const labels = response.Labels.map(label => label.Name);
      return labels;
    } catch (error) {
      console.error("Error detecting labels:", error);
      return [];
    }
  };

  // Function to compare labels between user and admin images
  const compareLabels = (userLabels, adminLabels) => {
    const commonLabels = userLabels.filter(label => adminLabels.includes(label));
    return commonLabels.length > 0;  // Return true if there's at least one matching label
  };

  // Function to fetch matched item details from DynamoDB
  const fetchMatchedItemDetails = async (matchedItemID) => {
    const itemParams = {
      TableName: "LostItems",
      Key: {
        "ItemID": { S: matchedItemID.split('/').pop() }  // Extract the ItemID from the image key
      }
    };

    const command = new GetItemCommand(itemParams);
    try {
      const data = await dynamoDb.send(command);
      if (data.Item) {
        console.log("Matched Item Details: ", data.Item);
        
        setMatchedItemDetails({
          name: data.Item.Name.S,
          description: data.Item.Description.S,
          location: data.Item.Location.S,
          imageUrl: data.Item.ImageUrl.S  // Matched image from S3
        });
        setMatch(true);  // Match found
      } else {
        console.log("No details found for this item.");
        setMatch(false);
      }
    } catch (error) {
      console.error("Error fetching matched item details:", error);
      setMatch(false);  // Ensure match is set to false on error
    }
  };

  // Toggle Admin/User mode
  const toggleAdminMode = () => {
    setAdminMode(!adminMode);
    setIsCameraActive(false);
    setIsAdminCamera(false);
    stopCamera();
  };

  // Handle starting the camera for user
  const handleUserCamera = () => {
    setIsAdminCamera(false);
    setIsCameraActive(true);
  };

  // Handle starting the camera for admin
  const handleAdminCamera = () => {
    setIsAdminCamera(true);
    setIsCameraActive(true);
  };

  // Reset the match result and labels when returning to main menu
  const handleReturnToMainMenu = () => {
    setMatch(null);
    setImage(null);
    setMatchedItemDetails(null);
    setDetectedLabels([]);
    setCapturedFromCamera(false);
  };

  return (
    <div className="App">
      <img src="/images/hawkfind-logo.png" alt="HawkFind Logo" className="logo" />
      <h1>HawkFind</h1>

      <div>
        <button onClick={toggleAdminMode}>
          {adminMode ? "Switch to User Mode" : "Switch to Admin Mode"}
        </button>

        {!adminMode && (
          <div>
            <button onClick={() => document.getElementById('fileInput').click()}>Upload Image</button>
            <button onClick={handleUserCamera}>Use Camera</button>
          </div>
        )}

        <input
          id="fileInput"
          type="file"
          accept="image/jpeg, image/png"
          onChange={handleUserFileUpload}
          style={{ display: 'none' }}
        />

        {adminMode && (
          <div>
            <h2>Add New Lost Item</h2>
            <input
              type="text"
              placeholder="Item Name"
              value={newItem.name}
              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            />
            <input
              type="text"
              placeholder="Location"
              value={newItem.location}
              onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
            />
            <input
              type="text"
              placeholder="Description"
              value={newItem.description}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            />
            <button onClick={() => document.getElementById('adminFileInput').click()}>Upload Image</button>
            <input
              id="adminFileInput"
              type="file"
              accept="image/jpeg, image/png"
              onChange={handleAdminFileUpload}
              style={{ display: 'none' }}
            />
            <button onClick={handleAdminCamera}>Use Camera</button>
          </div>
        )}

        {isCameraActive && (
          <div className="flex-container">
            <video ref={videoRef} width="100%" height="auto" playsInline autoPlay></video>
            <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
            <button onClick={captureImage}>Capture Image</button>
            <button onClick={stopCamera}>Cancel</button>
          </div>
        )}

        {/* Show captured image and buttons if captured from camera */}
        {capturedFromCamera && (
          <div>
            <h3>Captured Image:</h3>
            <img src={image} alt="Captured" width="300" />
            <button onClick={submitCapturedImage}>Submit Image</button>
            <button onClick={retakeImage}>Retake Image</button>
          </div>
        )}

        {loading && <p>Processing...</p>}

        {!loading && (
          <>
            {image && !capturedFromCamera && (
              <div>
                <h3>Your Uploaded Image:</h3>
                <img src={image} alt="Uploaded" width="300" />
              </div>
            )}

            {match && matchedItemDetails && (
              <div>
                <h2>Item Found!</h2>
                <p><strong>Name:</strong> {matchedItemDetails.name}</p>
                <p><strong>Location:</strong> {matchedItemDetails.location}</p>
                <p><strong>Description:</strong> {matchedItemDetails.description}</p>
                <img src={matchedItemDetails.imageUrl} alt="Matched Item" width="300" />
                <button onClick={handleReturnToMainMenu}>Return to Main Menu</button>
              </div>
            )}
          </>
        )}

        {detectedLabels.length > 0 && (
          <div>
            <h3>Detected Labels (Previous Upload):</h3>
            <ul>
              {detectedLabels.map((label, index) => (
                <li key={index}>{label}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
