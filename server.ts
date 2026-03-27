import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // In-memory state for the demo
  let orders = [];
  let events = [];

  const addEvent = (type, data) => {
    const event = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type,
      data,
    };
    events.push(event);
    if (events.length > 50) events.shift();
    return event;
  };

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Send initial state
    socket.emit("init", { orders, events });

    socket.on("order:create", (orderData) => {
      const newOrder = {
        ...orderData,
        id: Math.random().toString(36).substr(2, 9),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      orders.push(newOrder);
      
      const event = addEvent("ORDER_CREATED", newOrder);
      io.emit("order:created", newOrder);
      io.emit("event:new", event);
    });

    socket.on("order:update_status", ({ orderId, status }) => {
      const orderIndex = orders.findIndex((o) => o.id === orderId);
      if (orderIndex !== -1) {
        orders[orderIndex].status = status;
        orders[orderIndex].updatedAt = new Date().toISOString();
        
        const event = addEvent("ORDER_STATUS_UPDATED", orders[orderIndex]);
        io.emit("order:updated", orders[orderIndex]);
        io.emit("event:new", event);
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
