# Votech Backend - Refactored Structure

This document describes the refactored backend structure that breaks down the heavy `server.js` file into organized, modular route files.

## 🏗️ Architecture Overview

The backend has been refactored from a monolithic `server.js` file into a modular structure with separate route files for different functionalities.

## 📁 File Structure

```plain
backend/
├── server-refactored.js          # Main server file (refactored)
├── server.js                     # Original heavy server file
├── routes/
│   ├── utils.js                  # Shared utilities and middleware
│   ├── auth.js                   # Authentication routes
│   ├── fees.js                   # Fee management routes
│   ├── students.js               # Student management routes
│   ├── classes.js                # Class management routes
│   ├── teachers.js               # Teacher management routes
│   ├── users.js                  # User management routes
│   ├── messages.js               # Messaging system routes
│   ├── inventory.js              # Inventory management routes
│   ├── subjects.js               # Subject management routes (existing)
│   ├── lessonPlans.js            # Lesson plans routes (existing)
│   ├── lessons.js                # Lessons routes (existing)
│   ├── groups.js                 # Groups routes (existing)
│   ├── salary.js                 # Salary routes (existing)
│   ├── timetables.js             # Timetables routes (existing)
│   ├── cases.js                  # Cases routes (existing)
│   ├── attendance.js             # Attendance routes (existing)
│   ├── discipline_cases.js       # Discipline cases routes (existing)
│   ├── events.js                 # Events routes (existing)
│   └── applications.js           # Applications routes (existing)
```

## 🔧 Shared Utilities (`routes/utils.js`)

This file contains common functions and middleware used across all route modules:

- **Database Connection**: PostgreSQL pool configuration
- **Authentication Middleware**: JWT token verification
- **Admin Authorization**: Role-based access control
- **Activity Logging**: User activity tracking
- **Session Management**: User session creation/ending
- **Helper Functions**: IP address, user agent, admin checks

## 🛣️ Route Modules

### 1. Authentication Routes (`routes/auth.js`)

**Base Path**: `/api`

| Method | Endpoint           | Description          |
| ------ | ------------------ | -------------------- |
| GET    | `/test`            | Test endpoint        |
| POST   | `/setup-admin`     | Create admin user    |
| POST   | `/login`           | User login           |
| POST   | `/logout`          | User logout          |
| POST   | `/register`        | User registration    |
| POST   | `/check-user`      | Check user existence |
| POST   | `/reset-password`  | Reset user password  |
| POST   | `/change-password` | Change user password |

### 2. Fee Management Routes (`routes/fees.js`)

**Base Path**: `/api/fees`

| Method | Endpoint                       | Description                 |
| ------ | ------------------------------ | --------------------------- |
| GET    | `/total/yearly`                | Get yearly fee totals       |
| GET    | `/student/:id`                 | Get student fee stats       |
| POST   | `/`                            | Create fee payment          |
| GET    | `/class/:classId`              | Get class fee stats         |
| DELETE | `/payments/:id`                | Delete payment record       |
| DELETE | `/student/:studentId`          | Clear all student fees      |
| GET    | `/payments/student/:studentId` | Get student payment details |

### 3. Student Management Routes (`routes/students.js`)

**Base Path**: `/api/students`

| Method | Endpoint             | Description                |
| ------ | -------------------- | -------------------------- |
| GET    | `/analytics/daily`   | Daily student analytics    |
| GET    | `/analytics/monthly` | Monthly student analytics  |
| GET    | `/search`            | Search students            |
| GET    | `/:id/picture`       | Get student picture        |
| POST   | `/`                  | Create student             |
| GET    | `/`                  | Get all students           |
| DELETE | `/:id`               | Delete student             |
| POST   | `/import`            | Import students from Excel |

### 4. Class Management Routes (`routes/classes.js`)

**Base Path**: `/api/classes`

| Method | Endpoint        | Description           |
| ------ | --------------- | --------------------- |
| GET    | `/`             | Get all classes       |
| POST   | `/`             | Create class          |
| PUT    | `/:id`          | Update class          |
| DELETE | `/:id`          | Delete class          |
| GET    | `/:id`          | Get class by ID       |
| GET    | `/:id/students` | Get students in class |
| GET    | `/:id/stats`    | Get class statistics  |

### 5. Teacher Management Routes (`routes/teachers.js`)

**Base Path**: `/api/teachers`

| Method | Endpoint          | Description            |
| ------ | ----------------- | ---------------------- |
| POST   | `/`               | Create teacher         |
| GET    | `/`               | Get all teachers       |
| PUT    | `/:id`            | Update teacher         |
| DELETE | `/:id`            | Delete teacher         |
| PUT    | `/:id/status`     | Update teacher status  |
| GET    | `/:id`            | Get teacher by ID      |
| GET    | `/active/list`    | Get active teachers    |
| GET    | `/stats/overview` | Get teacher statistics |

### 6. User Management Routes (`routes/users.js`)

**Base Path**: `/api/users`

| Method | Endpoint                   | Description                      |
| ------ | -------------------------- | -------------------------------- |
| GET    | `/`                        | Get all users (admin)            |
| GET    | `/all-chat`                | Get users for chat               |
| GET    | `/chat-list`               | Get chat list with last messages |
| POST   | `/check-user-details`      | Check user details               |
| GET    | `/all`                     | Get all users (admin)            |
| PUT    | `/:id`                     | Update user                      |
| DELETE | `/:id`                     | Delete user                      |
| POST   | `/:id/suspend`             | Suspend/unsuspend user           |
| GET    | `/monitor/users`           | Get user monitoring data         |
| GET    | `/monitor/user-activities` | Get user activities              |
| GET    | `/monitor/user-sessions`   | Get user sessions                |

### 7. Messaging Routes (`routes/messages.js`)

**Base Path**: `/api/messages`

| Method | Endpoint          | Description                |
| ------ | ----------------- | -------------------------- |
| POST   | `/`               | Send message               |
| POST   | `/with-file`      | Send message with file     |
| GET    | `/:userId`        | Get messages between users |
| POST   | `/:userId/read`   | Mark messages as read      |
| GET    | `/unread/count`   | Get unread message count   |
| DELETE | `/:messageId`     | Delete message             |
| GET    | `/group/:groupId` | Get group messages         |

### 8. Inventory Management Routes (`routes/inventory.js`)

**Base Path**: `/api/inventory`

| Method | Endpoint            | Description              |
| ------ | ------------------- | ------------------------ |
| GET    | `/`                 | Get all inventory items  |
| POST   | `/`                 | Create inventory item    |
| PUT    | `/:id`              | Update inventory item    |
| DELETE | `/:id`              | Delete inventory item    |
| GET    | `/:id`              | Get inventory item by ID |
| GET    | `/stats/overview`   | Get inventory statistics |
| GET    | `/search/items`     | Search inventory items   |
| GET    | `/departments/list` | Get departments list     |

## 🔐 Authentication & Authorization

### Authentication Middleware

All protected routes use the `authenticateToken` middleware from `utils.js`:

```javascript
const { authenticateToken } = require("./routes/utils");
router.get("/protected-route", authenticateToken, (req, res) => {
  // Route logic here
});
```

### Admin Authorization

Admin-only routes use the `requireAdmin` middleware:

```javascript
const { requireAdmin } = require("./routes/utils");
router.post("/admin-only", authenticateToken, requireAdmin, (req, res) => {
  // Admin route logic here
});
```

## 📊 Activity Logging

All routes automatically log user activities using the `logUserActivity` function:

```javascript
const {
  logUserActivity,
  getIpAddress,
  getUserAgent,
} = require("./routes/utils");

// Log activity
const ipAddress = getIpAddress(req);
const userAgent = getUserAgent(req);
await logUserActivity(
  req.user.id,
  "create",
  "Created new item",
  "item_type",
  itemId,
  itemName,
  ipAddress,
  userAgent
);
```

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Environment Variables

Create a `.env` file with:

```plain
DB_NAME=your_database_name
DB_USER_NAME=your_username
DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret
DATABASE_URL=your_database_url
```

### 3. Run the Refactored Server

```bash
node server-refactored.js
```

### 4. Test the API

```bash
curl http://localhost:5000/api/test
```

## 🔄 Migration from Original Server

To migrate from the original `server.js` to the refactored version:

1. **Backup the original server**:

   ```bash
   cp server.js server.js.backup
   ```

2. **Replace with refactored version**:

   ```bash
   cp server-refactored.js server.js
   ```

3. **Test all endpoints** to ensure functionality is preserved

## 📈 Benefits of Refactoring

1. **Modularity**: Each functionality is in its own file
2. **Maintainability**: Easier to find and modify specific features
3. **Scalability**: Easy to add new route modules
4. **Code Reuse**: Shared utilities reduce duplication
5. **Testing**: Individual modules can be tested separately
6. **Team Collaboration**: Multiple developers can work on different modules
7. **Performance**: Better code organization leads to faster development

## 🐛 Troubleshooting

### Common Issues

1. **Module not found**: Ensure all route files exist in the `routes/` directory
2. **Database connection**: Check environment variables and database credentials
3. **Authentication errors**: Verify JWT_SECRET is set correctly
4. **CORS issues**: Ensure frontend URL is allowed in CORS configuration

### Debug Mode

Enable debug logging by setting:

```javascript
process.env.DEBUG = "true";
```

## 📝 Contributing

When adding new features:

1. Create a new route file in `routes/` directory
2. Follow the existing naming conventions
3. Use shared utilities from `utils.js`
4. Add proper error handling and logging
5. Update this documentation

## 🔗 API Documentation

For detailed API documentation, refer to the individual route files or use tools like Swagger/OpenAPI to generate documentation from the route definitions.
