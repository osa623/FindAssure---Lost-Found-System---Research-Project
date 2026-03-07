# FindAssure Backend - Lost & Found System

Backend API for the FindAssure mobile application, built as part of a Final Year Research Project.

## Tech Stack

- **Node.js** with **Express**
- **TypeScript** for type safety
- **MongoDB** with **Mongoose** ODM
- **Firebase Admin SDK** for authentication
- **REST API** architecture

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `MONGODB_URI`: Your MongoDB connection string
- `FIREBASE_PROJECT_ID`: Firebase project ID
- `FIREBASE_CLIENT_EMAIL`: Firebase service account email
- `FIREBASE_PRIVATE_KEY`: Firebase service account private key
- `IMAGE_PIPELINE_URL`: Image pipeline base URL (default: `http://127.0.0.1:8002`)
- `IMAGE_PIPELINE_TIMEOUT_MS`: Backend wait time for pipeline requests in milliseconds (default: `300000`)
- `PORT`: Server port (default: 5001)

### 3. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:5000`

### 4. Build for Production

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `GET /api/auth/me` - Get current user profile
- `PATCH /api/auth/me` - Update user profile

### Items (Lost & Found)
- `POST /api/items/found` - Report found item
- `GET /api/items/found` - List all found items
- `GET /api/items/found/:id` - Get single found item (owner view - no founder answers)
- `POST /api/items/lost` - Report lost item
- `GET /api/items/lost/me` - Get my lost item reports

### Verification
- `POST /api/items/verification` - Submit verification with video answers
- `GET /api/items/verification/:id` - Get verification details

### Admin
- `GET /api/admin/overview` - Dashboard statistics
- `GET /api/admin/found-items` - List all found items (with full details)
- `PATCH /api/admin/found-items/:id` - Update found item status
- `GET /api/admin/users` - List all users
- `PATCH /api/admin/users/:id` - Update user details

## Project Structure

```
src/
├── app.ts                    # Express app configuration
├── server.ts                 # Server entry point
├── config/
│   ├── db.ts                # MongoDB connection
│   └── firebaseAdmin.ts     # Firebase Admin SDK setup
├── middleware/
│   ├── authMiddleware.ts    # Authentication & authorization
│   └── errorHandler.ts      # Centralized error handling
├── models/
│   ├── User.ts              # User model
│   ├── FoundItem.ts         # Found item model
│   ├── LostRequest.ts       # Lost item request model
│   └── Verification.ts      # Verification model
├── controllers/
│   ├── authController.ts    # Auth logic
│   ├── itemController.ts    # Items logic
│   └── adminController.ts   # Admin operations
├── routes/
│   ├── authRoutes.ts        # Auth routes
│   ├── itemRoutes.ts        # Item routes
│   └── adminRoutes.ts       # Admin routes
├── services/
│   ├── itemService.ts       # Item business logic
│   └── verificationService.ts # Verification logic
└── utils/
    └── types.ts             # Shared TypeScript types
```

## Security Features

- Firebase token verification for all protected routes
- Role-based access control (owner, founder, admin)
- Founder answers are hidden from owner endpoints
- Admin-only access for sensitive operations

## License

Academic Project - SLIIT Research
