// OPTIONAL. The server already seeds rooms and default accounts on first start.
// Run with:  mongosh "mongodb://127.0.0.1:27017" database/seed.js
const d = db.getSiblingDB("or_scheduling");
[["OR-1","Operating Room 1","General Surgery"],["OR-2","Operating Room 2","Orthopedic"],["OR-3","Operating Room 3","OB-GYN"],["OR-4","Operating Room 4","Cardiac"]]
  .forEach(([c,n,s]) => d.operating_rooms.updateOne({roomCode:c},{$setOnInsert:{roomCode:c,roomName:n,specialty:s,location:"Main OR Complex",status:"Active"}},{upsert:true}));
print("Rooms in or_scheduling:", d.operating_rooms.countDocuments());
