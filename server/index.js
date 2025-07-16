const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Models (assumed to be defined in separate files)
const User = require('./model/User');
const Property = require('./model/Property');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080; // Fallback to 8080 for Railway compatibility

// **Cloudinary Configuration with Error Handling**
try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('Cloudinary configured successfully');
} catch (err) {
  console.error('Cloudinary config error:', err);
}

// **Multer Storage Configuration for Cloudinary**
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'property_images',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }],
  },
});
const upload = multer({ storage });

// **Middleware**
app.use(cors());
app.use(express.json());

// **MongoDB Connection with Error Handling**
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1); // Exit process if MongoDB fails
  });

// **JWT Authentication Middleware with Error Logging**
const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error('JWT verification error:', err);
    return res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
};

// **Routes**

// Root Route
app.get('/', (req, res) => {
  console.log('Root endpoint hit');
  res.send('ClearPLOT backend is live!');
});

// Register Route
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    const newUser = new User({ name, email, password });
    await newUser.save();
    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email & password required' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION,
    });

    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Post Property Route with Image Upload
app.post("/post-properties", authenticateUser, upload.array("images", 5), async (req, res) => {
  try {
    const form = req.body;
    const imageUrls = req.files.map(file => file.path);

    const binaryFields = [
      'Resale', 'MaintenanceStaff', 'Gymnasium', 'SwimmingPool', 'LandscapedGardens', 'JoggingTrack', 'RainWaterHarvesting',
      'IndoorGames', 'ShoppingMall', 'Intercom', 'SportsFacility', 'ATM', 'ClubHouse', 'School', '24X7Security', 'PowerBackup',
      'CarParking', 'StaffQuarter', 'Cafeteria', 'MultipurposeRoom', 'Hospital', 'WashingMachine', 'Gasconnection', 'AC', 'Wifi',
      'Childrensplayarea', 'LiftAvailable', 'BED', 'VaastuCompliant', 'Microwave', 'GolfCourse', 'TV', 'DiningTable', 'Sofa',
      'Wardrobe', 'Refrigerator'
    ];

    const BinaryFeatures = {};
    for (const field of binaryFields) {
      if (field in form) BinaryFeatures[field] = form[field];
    }

    let predictedPrice = parseFloat(form.PredictedPrice);
    if (!predictedPrice || isNaN(predictedPrice)) {
      predictedPrice = form.ListingType === 'Rent'
        ? 0.3 * parseFloat(form.Price || 0)
        : parseFloat(form.Price || 0);
    }

    const newProperty = new Property({
      userId: req.userId,
      ListingType: form.ListingType,
      PropertyType: form.PropertyType,
      City: form.City,
      Area: parseFloat(form.Area),
      Bedrooms: parseInt(form['No. of Bedrooms'], 10),
      Latitude: parseFloat(form.Latitude),
      Longitude: parseFloat(form.Longitude),
      Price: parseFloat(form.Price),
      PredictedPrice: predictedPrice,
      BinaryFeatures,
      images: imageUrls,
      Description: form.Description,
    });

    await newProperty.save();
    res.status(201).json({ message: "Property posted successfully", property: newProperty });
  } catch (err) {
    console.error('Post property error:', err);
    res.status(500).json({ error: "Failed to post property" });
  }
});

// Get User by ID Route
app.get("/get-user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("name email");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ message: "Error fetching user" });
  }
});

// Get Filtered Properties Route with Pagination
app.get('/get-properties', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let userId = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch (err) {
        console.error('JWT verification error in get-properties:', err);
      }
    }

    const {
      city, minPrice, maxPrice, amenities, propertyType, listingType, minArea, maxArea,
      page = 1, limit = 10
    } = req.query;

    let filter = {};
    if (userId) filter.userId = { $ne: userId }; // Exclude own listings if logged in

    if (city) filter.City = city;
    if (propertyType) filter.PropertyType = propertyType;
    if (listingType) filter.ListingType = listingType;
    if (minPrice) filter.Price = { $gte: parseFloat(minPrice) };
    if (maxPrice) filter.Price = { ...filter.Price, $lte: parseFloat(maxPrice) };
    if (minArea) filter.Area = { ...filter.Area, $gte: parseFloat(minArea) };
    if (maxArea) filter.Area = { ...filter.Area, $lte: parseFloat(maxArea) };

    if (amenities) {
      const amenityList = amenities.split(',');
      for (const amenity of amenityList) {
        filter[`BinaryFeatures.${amenity}`] = "Yes";
      }
    }

    const properties = await Property.find(filter)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalProperties = await Property.countDocuments(filter);

    res.json({
      properties,
      totalProperties,
      totalPages: Math.ceil(totalProperties / limit),
      currentPage: Number(page)
    });
  } catch (err) {
    console.error('Get properties error:', err);
    res.status(500).json({ message: 'Failed to fetch properties' });
  }
});

// Enhance Property Description Route
app.post("/enhance-description", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  try {
    const response = await fetch("https://api.cohere.ai/v1/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.COHERE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "command-r-plus",
        message: `Rewrite the following property description to be more detailed yet short like readable max to max 5 lines , professional, and appealing. Focus on key features and location, and make it engaging for potential buyers or renters. Avoid adding any unnecessary feedback, commentary, or filler text.  Property Description: ${prompt}`,
        temperature: 0.7,
        max_tokens: 300
      })
    });

    const data = await response.json();
    const enhanced = data.text || data.generation || data.message?.content;

    res.json({ enhanced });
  } catch (err) {
    console.error("Enhancement error:", err);
    res.status(500).json({ error: "Failed to enhance", detail: err.message });
  }
});

// **Global Error Handlers**
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// **Start Server with Error Handling**
try {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
} catch (err) {
  console.error('Server startup error:', err);
}