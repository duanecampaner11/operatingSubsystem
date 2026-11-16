# SurgiSchedule OR – Operating Room & Surgical Scheduling System (Node.js)
Subsystem of the Integrated Hospital Information System. Node.js + Express + MongoDB (`or_scheduling`).

## Run (VS Code, Windows)
1. Install **Node.js 18+ (LTS)** and **MongoDB Community Server** (service running). Open the folder in VS Code.
2. Terminal (Ctrl+`):  `npm install`
3. Start:  `npm start`   (auto-restart while editing: `npm run dev`)
4. Open http://localhost:5050/ · admin: http://localhost:5050/admin.html · health: http://localhost:5050/api/health

Optional env vars (PowerShell): `$env:OR_MONGO_URI="mongodb://127.0.0.1:27017"; $env:OR_MONGO_DB="or_scheduling"; $env:PORT="5050"; $env:ADMIN_PASSWORD="Admin@123"`

Default accounts (created on first start - change these passwords): admin/Admin@123 · scheduler/Sched@123 · surgeon/Surgeon@123 · anesth/Anes@123 · nurse/Nurse@123

## Structure
- `server.js` – API, scheduling/conflict logic, auth, audit, MongoDB setup
- `public/` – web pages (index.html portal, admin.html, css, js)
- `database/seed.js` – optional mongosh seed
