const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const jwt = require("jsonwebtoken");
const { promisify } = require("util");

const { sequelize } = require("../db");

const protect = catchAsync(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new AppError(
      "Invalid auth token, please login to access this resource",
      StatusCodes.UNAUTHORIZED
    );
  }



  const decodedToken = await promisify(jwt.verify)(
    token,
    process.env.JWT_SECRET
  );

  // Raw SQL query to fetch user by id
  const [results] = await sequelize.query(
    "SELECT * FROM public.users WHERE id = :id LIMIT 1",
    {
      replacements: { id: decodedToken.id },
      type: sequelize.QueryTypes.SELECT,
    }
  );

  const user = results; // result is already plain object due to QueryTypes.SELECT

  if (!user) {
    throw new AppError(
      "This user no longer exists in the database",
      StatusCodes.NOT_FOUND
    );
  }

  if (
    user.passwordChangedAt &&
    new Date(user.passwordChangedAt).getTime() / 1000 > decodedToken.iat
  ) {
    throw new AppError(
      "User password was changed! Please login again to access this resource",
      StatusCodes.UNAUTHORIZED
    );
  }

  req.user = { ...user, role: decodedToken.role };

  next();
});

const restrictTo = (...roles) => {
  return catchAsync(async (req, res, next) => {
    if (!req.user) {
      throw new AppError(
        "No user info found on request",
        StatusCodes.UNAUTHORIZED
      );
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError("Unauthorized Request", StatusCodes.FORBIDDEN);
    }

    next();
  });
};

// ID Card Generation Functionality
const puppeteer = require('puppeteer');
const models = require('../models/index.model');

// Simple image processing for lightweight files
const processStudentPhoto = (photoData) => {
  if (!photoData) return null;
  
  try {
    // Convert photo to base64 string
    let base64String;
    
    if (Buffer.isBuffer(photoData)) {
      base64String = photoData.toString('base64');
    } else if (typeof photoData === 'string') {
      if (photoData.startsWith('data:image/')) {
        return photoData; // Already a data URL
      }
      base64String = photoData;
    } else {
      base64String = Buffer.from(String(photoData)).toString('base64');
    }
    
    // Create a clean data URL
    return `data:image/jpeg;base64,${base64String}`;
    
  } catch (error) {
    console.error('Error processing student photo:', error);
    return null;
  }
};

const generateIDCardHTML = (student, schoolInfo) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: 86mm 54mm; margin: 2mm; }
      body { margin: 0; padding: 0; font-family: Arial; background: white; }
      .card {
        width: 82mm; height: 50mm; border: 1px solid #ccc; position: relative;
        background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
        overflow: hidden;
      }
      .header {
        background: #2c3e50; color: white; padding: 2mm 3mm; text-align: center;
        font-size: 8pt; font-weight: bold;
      }
      .photo-section {
        position: absolute; left: 3mm; top: 8mm; width: 15mm; height: 18mm;
        border: 1px solid #333; background: white; display: flex;
        align-items: center; justify-content: center; overflow: hidden;
      }
      .photo {
        width: 100%; height: 100%; object-fit: cover;
        image-rendering: optimizeSpeed; image-rendering: pixelated;
      }
      .info-section {
        margin-left: 20mm; margin-right: 3mm; padding-top: 8mm;
      }
      .student-name {
        font-size: 10pt; font-weight: bold; margin: 0; color: #2c3e50;
      }
      .student-info {
        font-size: 7pt; margin: 1mm 0; color: #555;
      }
      .student-id {
        font-size: 8pt; font-weight: bold; color: #e74c3c; margin-top: 2mm;
      }
      .footer {
        position: absolute; bottom: 2mm; left: 3mm; right: 3mm;
        text-align: center; font-size: 6pt; color: #777;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">${schoolInfo.name}</div>
      <div class="photo-section">
        ${student.processedPhoto ? 
          `<img src="${student.processedPhoto}" class="photo" alt="Student Photo">` : 
          '<div style="font-size: 4pt; text-align: center; color: #999;">No Photo</div>'
        }
      </div>
      <div class="info-section">
        <p class="student-name">${student.full_name}</p>
        <p class="student-info">ID: ${student.student_id}</p>
        <p class="student-info">Class: ${student.class?.name || 'N/A'}</p>
        <p class="student-info">DOB: ${new Date(student.date_of_birth).toLocaleDateString()}</p>
        <p class="student-info">Sex: ${student.sex}</p>
        <p class="student-id">CARD: ${student.card_number || 'PENDING'}</p>
      </div>
      <div class="footer">
        ${schoolInfo.address} | ${schoolInfo.phone} | Valid: ${new Date().getFullYear()}-${new Date().getFullYear() + 1}
      </div>
    </div>
  </body>
  </html>
  `;
};

// Generate bulk ID cards for a class - optimized for lightweight files
const generateClassIDCards = catchAsync(async (req, res, next) => {
  const { classId } = req.params;
  
  const students = await models.students.findAll({
    where: { class_id: classId },
    include: [{ model: models.classes, as: 'class', attributes: ['id', 'name'] }],
    order: [['full_name', 'ASC']]
  });
  
  if (students.length === 0) {
    return next(new AppError('No students found in this class', 404));
  }
  
  const schoolInfo = {
    name: 'VOTECH ACADEMY',
    address: 'Cameroon',
    phone: '+237 XXX XXX XXX'
  };
  
  // Process photos with lightweight optimization
  const processedStudents = students.map(student => ({
    ...student.toJSON(),
    processedPhoto: student.photo ? processStudentPhoto(student.photo) : null,
    card_number: `V${student.student_id.slice(-6)}`
  }));
  
  // Generate HTML
  const allCardsHTML = processedStudents
    .map(student => generateIDCardHTML(student, schoolInfo))
    .join('<div style="page-break-after: always;"></div>');
  
  // Memory-efficient Puppeteer settings
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--disable-default-apps',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--memory-pressure-off'
    ]
  });
  
  try {
    const page = await browser.newPage();
    await page.setContent(allCardsHTML, { waitUntil: 'domcontentloaded' });
    
    // Optimized PDF settings for minimal file size
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '5mm', right: '5mm', bottom: '5mm', left: '5mm' },
      preferCSSPageSize: true,
      scale: 0.8,
      displayHeaderFooter: false
    });
    
    await browser.close();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ID_Cards_Class_${classId}_${Date.now()}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
    
  } catch (error) {
    await browser.close();
    throw error;
  }
});

module.exports = {
  restrictTo,
  protect,
  generateClassIDCards,
};
