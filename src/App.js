import React, { useState, useRef } from 'react';
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
  const [useCamera, setUseCamera] = useState(false);
  const [adminMode, setAdminMode] = useState(false);  // Admin mode toggle
  const [newItem, setNewItem] = useState({ name: '', location: '', description: '', image: null });
  const [adminUseCamera, setAdminUseCamera] = useState(false);
  const [matchedItemDetails, setMatchedItemDetails] = useState(null);  // Matched item details

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Upload image to S3 and compare labels for user uploads
  const handleUserFileUpload = async (e) => {
    const file = e.target.files[0];

    // Check if file type is JPEG or PNG
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      alert('Only JPEG and PNG images are supported');
      return;
    }

    setImage(URL.createObjectURL(file));  // Display uploaded image

    // Upload user image to S3
    await uploadUserImageToS3(file);

    // Detect labels for the user-uploaded image and compare with reference images in S3
    const matchFound = await compareWithAllAdminImages(file);
    
    // Detect labels and store them for demo purposes
    const userLabels = await detectLabelsInImage(`user-uploads/${file.name}`);
    setDetectedLabels(userLabels);

    if (!matchFound) {
      alert("No match found.");  // Show alert if no match is found
      setImage(null);  // Clear the uploaded image after no match is found
    }
  };

  // Upload the user's image to S3
  const uploadUserImageToS3 = async (file) => {
    setLoading(true);
    try {
      const uploadParams = {
        Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
        Key: `user-uploads/${file.name}`,  // Store user image in user-uploads folder
        Body: file,
        ContentType: file.type  // Ensure correct content type (important for Rekognition)
      };
      const command = new PutObjectCommand(uploadParams);
      await s3.send(command);
      console.log(`Successfully uploaded user image: ${file.name}`);
    } catch (error) {
      console.error("Error uploading user image to S3: ", error);
    }
    setLoading(false);
  };

  // List all admin images in the S3 bucket and compare against the user-uploaded image
  const compareWithAllAdminImages = async (file) => {
    setLoading(true);
    let matchFound = false;  // Flag to track if a match is found

    try {
      // List all objects (images) in the 'admin/' folder
      const listParams = {
        Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
        Prefix: 'admin/'  // Only list objects in the 'admin/' folder
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const response = await s3.send(listCommand);

      if (response.Contents && response.Contents.length > 0) {
        // Loop through each image in the 'admin/' folder and compare it with the user-uploaded image
        for (const adminImage of response.Contents) {
          const adminImageKey = adminImage.Key;

          // Detect labels in the admin image
          const adminLabels = await detectLabelsInImage(adminImageKey);

          // Detect labels in the user-uploaded image
          const userLabels = await detectLabelsInImage(`user-uploads/${file.name}`);

          // Compare labels between the user and admin images
          if (compareLabels(userLabels, adminLabels)) {
            console.log("Labels match with:", adminImageKey);
            
            // If a match is found, fetch the item details from DynamoDB
            await fetchMatchedItemDetails(adminImageKey);
            matchFound = true;  // Set the flag to true
            break;  // Exit loop after first match
          }
        }
      } else {
        console.log("No images found in the admin folder.");
        setMatch(null);
      }
    } catch (error) {
      console.error("Error listing admin images or comparing labels: ", error);
    }
    setLoading(false);

    return matchFound;  // Return whether a match was found or not
  };

  // Detect labels in an image using Rekognition
  const detectLabelsInImage = async (imageKey) => {
    const detectParams = {
      Image: {
        S3Object: {
          Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
          Name: imageKey
        }
      },
      MaxLabels: 10,  // Adjust the number of labels detected if necessary
      MinConfidence: 70  // Minimum confidence for detected labels
    };
  
    try {
      const command = new DetectLabelsCommand(detectParams);
      const response = await rekognition.send(command);
      const labels = response.Labels.map(label => label.Name);
      console.log(`Detected labels for ${imageKey}:`, labels);
      return labels;
    } catch (error) {
      // Handle InvalidImageFormatException silently
      if (error.name === 'InvalidImageFormatException') {
        console.warn("Silent: Invalid image format. Ignoring this error for the demo.");
        return [];
      } 
      
      // Handle 400 Bad Request silently
      if (error.$metadata && error.$metadata.httpStatusCode === 400) {
        console.warn("Silent: 400 Bad Request from Rekognition API. Ignoring this error for the demo.");
        return [];
      }
  
      // Log any other errors that aren't explicitly handled
      console.error("Error detecting labels:", error);
      return [];
    }
  };

  // Compare the labels from two images
  const compareLabels = (userLabels, adminLabels) => {
    const commonLabels = userLabels.filter(label => adminLabels.includes(label));
    return commonLabels.length > 0;  // Return true if there's at least one matching label
  };

  // Fetch the matched item details from DynamoDB
  const fetchMatchedItemDetails = async (matchedItemID) => {
    const itemParams = {
      TableName: "LostItems",  // Your DynamoDB table name
      Key: {
        "ItemID": { S: matchedItemID.split('/').pop() }  // Extract the ItemID from the image key
      }
    };

    const command = new GetItemCommand(itemParams);
    try {
      const data = await dynamoDb.send(command);
      if (data.Item) {
        setMatchedItemDetails({
          name: data.Item.Name.S,
          description: data.Item.Description.S,
          location: data.Item.Location.S,
          imageUrl: data.Item.ImageUrl.S  // Matched image from S3
        });
        setMatch(true);  // Match found
      } else {
        alert("No details found for this item.");
        setMatch(null);
      }
    } catch (error) {
      console.error("Error retrieving item metadata: ", error);
    }
  };

  // Admin mode: Handle file upload for new lost item
  const handleAdminFileUpload = async (e) => {
    const file = e.target.files[0];
    setNewItem({ ...newItem, image: URL.createObjectURL(file) });
    await uploadAdminImageToS3(file);  // Upload admin image to S3
  };

  // Upload the admin's image to S3 and store metadata in DynamoDB
  const uploadAdminImageToS3 = async (file) => {
    setLoading(true);
    try {
      const uploadParams = {
        Bucket: process.env.REACT_APP_AWS_BUCKET_NAME,
        Key: `admin/${file.name}`,  // Store admin image in the admin folder
        Body: file,
        ContentType: file.type  // Ensure correct content type
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

  const startAdminCamera = () => {
    setAdminUseCamera(true);
    const constraints = {
      video: { facingMode: { exact: 'environment' } }
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      })
      .catch((err) => {
        console.error("Error accessing the camera: ", err);
      });
  };

  const captureAdminImage = () => {
    const context = canvasRef.current.getContext('2d');
    context.drawImage(videoRef.current, 0, 0, 640, 480);
    const capturedImage = canvasRef.current.toDataURL('image/jpeg');  // Ensure correct format
    setNewItem({ ...newItem, image: capturedImage });
    stopCamera();
  };

  const stopCamera = () => {
    if (videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setAdminUseCamera(false);
  };

  // Toggle Admin/User mode
  const toggleAdminMode = () => {
    setAdminMode(!adminMode);
  };

  // Reset the match result and labels when returning to main menu
  const handleReturnToMainMenu = () => {
    setMatch(null);
    setImage(null);
    setMatchedItemDetails(null);
  };

  return (
    <div className="App">
      <img src="/images/hawkfind-logo.png" alt="HawkFind Logo" className="logo" />
      <h1>Lost and Found</h1>

      <div>
        {/* Button to toggle between Admin and User mode */}
        <button onClick={toggleAdminMode}>
          {adminMode ? "Switch to User Mode" : "Switch to Admin Mode"}
        </button>

        {/* User mode */}
        {!adminMode && (
          <div>
            <button onClick={() => document.getElementById('fileInput').click()}>Upload Image</button>
            <button onClick={startAdminCamera}>Use Camera</button>
          </div>
        )}

        {/* File input for user search */}
        <input
          id="fileInput"
          type="file"
          accept="image/jpeg, image/png"  // Ensure only valid image formats can be selected
          onChange={handleUserFileUpload}
          style={{ display: 'none' }}
        />

        {/* Admin mode */}
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
              accept="image/jpeg, image/png"  // Ensure only valid image formats
              onChange={handleAdminFileUpload}
              style={{ display: 'none' }}
            />
            {adminUseCamera && (
              <div className="flex-container">
                <video ref={videoRef} width="100%" height="auto" playsInline autoPlay></video>
                <button onClick={captureAdminImage}>Capture Image</button>
                <button onClick={stopCamera}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {loading && <p>Processing...</p>}

        {/* Show user's uploaded image */}
        {image && !loading && <img src={image} alt="Uploaded" width="300" />}

        {/* Display match result */}
        {match && matchedItemDetails && (
          <div>
            <h2>Item Found!</h2>
            <p><strong>Name:</strong> {matchedItemDetails.name}</p>
            <p><strong>Location:</strong> {matchedItemDetails.location}</p>
            <p><strong>Description:</strong> {matchedItemDetails.description}</p>
            <img src={matchedItemDetails.imageUrl} alt="Matched Item" width="300" />
            <h3>Your uploaded item:</h3>
            <img src={image} alt="Uploaded" width="300" />
            <button onClick={handleReturnToMainMenu}>Return to Main Menu</button>
          </div>
        )}

        {/* Display detected labels below the main buttons */}
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
