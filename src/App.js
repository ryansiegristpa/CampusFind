import React, { useState, useRef } from 'react';
import './App.css';

function App() {
  const [image, setImage] = useState(null);  // Store uploaded image or captured image
  const [loading, setLoading] = useState(false);  // Simulate loading state
  const [match, setMatch] = useState(null);  // Store the matched item result
  const [useCamera, setUseCamera] = useState(false);  // Toggle for camera usage

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Mock item database (this simulates the backend data)
  const items = [
    {
      name: 'Blue Backpack',
      image: '/images/blue-backpack.jpg',
      location: 'Student Union Lost & Found',
      description: 'A blue Jansport backpack with 3 patches on the front.'
    },
    {
      name: 'Black Wallet',
      image: '/images/black-wallet.jpg',
      location: 'Library Lost & Found',
      description: 'A leather wallet with a university ID inside.'
    }
  ];

  // Handle file upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    setImage(URL.createObjectURL(file));  // Display uploaded image
    simulateSearch();
  };

  // Simulate searching for a match
  const simulateSearch = () => {
    setLoading(true);  // Start loading
    setTimeout(() => {
      const foundItem = items[0];  // Simulate finding the "Blue Backpack"
      setMatch(foundItem);
      setLoading(false);  // Stop loading
    }, 2000);  // Simulate delay
  };

  // Start the device camera
  const startCamera = () => {
    setUseCamera(true);
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((stream) => {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      })
      .catch((err) => {
        console.error("Error accessing the camera: ", err);
      });
  };

  // Capture image from the camera
  const captureImage = () => {
    const context = canvasRef.current.getContext('2d');
    context.drawImage(videoRef.current, 0, 0, 640, 480);
    const capturedImage = canvasRef.current.toDataURL('image/png');
    setImage(capturedImage);  // Display the captured image
    simulateSearch();  // Simulate searching for a match
    stopCamera();  // Stop the camera after capture
  };

  // Stop the camera
  const stopCamera = () => {
    if (videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setUseCamera(false);
  };

  return (
    <div className="App">
      <h1>Lost and Found</h1>

      <div>
        {/* Buttons for file upload and camera */}
        {!useCamera && (
          <div>
            <button onClick={() => document.getElementById('fileInput').click()}>Upload Image</button>
            <button onClick={startCamera}>Use Camera</button>
          </div>
        )}

        {/* File input (hidden by default, triggered by button) */}
        <input
          id="fileInput"
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />

        {/* Camera view */}
        {useCamera && (
          <div className="flex-container">
            <video
              ref={videoRef}
              width="100%"  // Adjust to fit mobile screen
              height="auto"
              playsInline
              autoPlay
            ></video>
            <button onClick={captureImage}>Capture Image</button>
            <button onClick={stopCamera}>Cancel</button>
          </div>
        )}

        {/* Show loading message */}
        {loading && <p>Searching for your item...</p>}

        {/* Display uploaded or captured image */}
        {image && !loading && !useCamera && <img src={image} alt="Uploaded" width="300" />}
        <canvas ref={canvasRef} width="640" height="480" style={{ display: 'none' }}></canvas>

        {/* Show matched item result */}
        {match && (
          <div>
            <h2>Item Found!</h2>
            <p><strong>Name:</strong> {match.name}</p>
            <p><strong>Location:</strong> {match.location}</p>
            <p><strong>Description:</strong> {match.description}</p>
            <img src={match.image} alt={match.name} width="300" />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
