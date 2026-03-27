import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShoppingBag, 
  ClipboardList, 
  Activity, 
  CheckCircle2, 
  Clock, 
  ChefHat, 
  Truck, 
  AlertCircle,
  Plus,
  User as UserIcon,
  Settings,
  LogOut,
  LogIn,
  ShieldCheck,
  UserCircle
} from 'lucide-react';
import { Order, OrderStatus, SyncEvent } from './types';
import { cn } from './lib/utils';
import { auth, db, loginWithGoogle, logout, loginWithEmail, registerWithEmail } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, onSnapshot, orderBy, addDoc, updateDoc, doc, setDoc, getDoc, where, deleteDoc } from 'firebase/firestore';

interface MenuItem {
  id: string;
  name: string;
  price: number;
}

const DEFAULT_MENU_ITEMS = [
  { name: 'Classic Burger', price: 12.99 },
  { name: 'Truffle Fries', price: 6.50 },
  { name: 'Garden Salad', price: 9.99 },
  { name: 'Iced Latte', price: 4.50 },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [view, setView] = useState<'customer' | 'admin'>('customer');
  const [adminSubView, setAdminSubView] = useState<'orders' | 'menu'>('orders');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const profile = userSnap.data();
          setUserProfile(profile);
          if (profile.role === 'admin') {
            setView('admin');
          }
        }
      } else {
        setUserProfile(null);
        setView('customer');
      }
      setLoading(false);
    });

    // Keep Socket.io for the "Sync Engine Log" demo feel
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('event:new', (event: SyncEvent) => {
      setEvents(prev => [event, ...prev].slice(0, 50));
    });

    // Fetch menu items
    const unsubscribeMenu = onSnapshot(collection(db, 'menu'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as MenuItem));
      setMenuItems(items);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeMenu();
      socket.disconnect();
    };
  }, []);

  // Separate effect for orders to handle role-based filtering
  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }

    let q;
    if (userProfile?.role === 'admin') {
      // Admins can see all orders, ordered by date
      q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    } else {
      // Customers can only see their own orders
      // We filter by customerUid to comply with security rules
      // We don't use orderBy here to avoid requiring a composite index
      q = query(collection(db, 'orders'), where('customerUid', '==', user.uid));
    }

    const unsubscribeOrders = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Order));
      
      // Sort client-side to avoid composite index requirement for customers
      const sortedOrders = ordersData.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      setOrders(sortedOrders);
    }, (error) => {
      console.error("Firestore error:", error);
    });

    return () => unsubscribeOrders();
  }, [user, userProfile]);

  const createOrder = async (customerName: string, items: any[]) => {
    if (!user) return;
    const total = items.reduce((sum, item) => sum + item.price, 0);
    
    // Generate a doc reference first to get the ID
    const orderRef = doc(collection(db, 'orders'));
    
    const newOrder = {
      id: orderRef.id, // Required by security rules
      customerUid: user.uid,
      customerName,
      items: items.map(item => ({
        ...item,
        quantity: item.quantity || 1 // Ensure quantity exists
      })),
      total,
      status: 'pending' as OrderStatus,
      createdAt: new Date().toISOString(),
    };
    
    try {
      await setDoc(orderRef, newOrder);
      socketRef.current?.emit('event:new', {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        type: 'ORDER_CREATED',
        data: newOrder
      });
    } catch (error) {
      console.error("Error creating order:", error);
    }
  };

  const updateStatus = async (orderId: string, status: OrderStatus) => {
    if (!userProfile || userProfile.role !== 'admin') return;
    try {
      const orderRef = doc(db, 'orders', orderId);
      await updateDoc(orderRef, { status, updatedAt: new Date().toISOString() });
      
      socketRef.current?.emit('event:new', {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        type: 'ORDER_STATUS_UPDATED',
        data: { orderId, status }
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const addMenuItem = async (name: string, price: number) => {
    if (userProfile?.role !== 'admin') return;
    try {
      await addDoc(collection(db, 'menu'), { name, price });
    } catch (error) {
      console.error("Error adding menu item:", error);
    }
  };

  const updateMenuItem = async (id: string, name: string, price: number) => {
    if (userProfile?.role !== 'admin') return;
    try {
      await updateDoc(doc(db, 'menu', id), { name, price });
    } catch (error) {
      console.error("Error updating menu item:", error);
    }
  };

  const deleteMenuItem = async (id: string) => {
    if (userProfile?.role !== 'admin') return;
    try {
      await deleteDoc(doc(db, 'menu', id));
    } catch (error) {
      console.error("Error deleting menu item:", error);
    }
  };

  const seedMenu = async () => {
    if (userProfile?.role !== 'admin') return;
    for (const item of DEFAULT_MENU_ITEMS) {
      await addDoc(collection(db, 'menu'), item);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Activity className="w-12 h-12 text-orange-500 animate-spin" />
          <p className="text-gray-500 font-medium animate-pulse">Initializing Sync Engine...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={loginWithGoogle} />;
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-orange-100">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-200">
            <Activity className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">SyncOrder</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Event Sync Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={cn(
            "hidden md:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
            connected ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-700 border-red-100"
          )}>
            <div className={cn("w-2 h-2 rounded-full animate-pulse", connected ? "bg-green-500" : "bg-red-500")} />
            {connected ? "LIVE SYNC" : "DISCONNECTED"}
          </div>
          
          <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
            <button 
              onClick={() => setView('customer')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                view === 'customer' ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              <UserIcon size={16} /> Customer
            </button>
            {userProfile?.role === 'admin' && (
              <button 
                onClick={() => setView('admin')}
                className={cn(
                  "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                  view === 'admin' ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                )}
              >
                <ShieldCheck size={16} /> Admin
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-gray-900 leading-none">{user.displayName}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">{userProfile?.role || 'User'}</p>
            </div>
            <img 
              src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
              alt={user.displayName || 'User'} 
              className="w-8 h-8 rounded-full border border-gray-200"
              referrerPolicy="no-referrer"
            />
            <button 
              onClick={logout}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-8 space-y-8">
          {view === 'customer' ? (
            <CustomerDashboard orders={orders} menuItems={menuItems} onCreateOrder={createOrder} user={user} />
          ) : (
            <div className="space-y-6">
              <div className="flex gap-4 border-b border-gray-200">
                <button 
                  onClick={() => setAdminSubView('orders')}
                  className={cn(
                    "pb-2 px-1 text-sm font-bold transition-all",
                    adminSubView === 'orders' ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-400"
                  )}
                >
                  Orders
                </button>
                <button 
                  onClick={() => setAdminSubView('menu')}
                  className={cn(
                    "pb-2 px-1 text-sm font-bold transition-all",
                    adminSubView === 'menu' ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-400"
                  )}
                >
                  Menu Management
                </button>
              </div>
              
              {adminSubView === 'orders' ? (
                <AdminDashboard orders={orders} onUpdateStatus={updateStatus} />
              ) : (
                <MenuManagement 
                  menuItems={menuItems} 
                  onAdd={addMenuItem} 
                  onUpdate={updateMenuItem} 
                  onDelete={deleteMenuItem}
                  onSeed={seedMenu}
                />
              )}
            </div>
          )}
        </div>

        {/* Sidebar: Event Engine Log */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-160px)] sticky top-24">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <h2 className="font-bold text-sm flex items-center gap-2 uppercase tracking-tight">
                <Activity size={16} className="text-orange-500" />
                Sync Engine Log
              </h2>
              <span className="text-[10px] font-mono text-gray-400">v1.1.0-firebase</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-[11px]">
              <AnimatePresence initial={false}>
                {events.map((event) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-100 group hover:border-orange-200 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[9px] font-bold",
                        event.type.includes('CREATED') ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {event.type}
                      </span>
                      <span className="text-gray-400">{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-gray-600 break-all">
                      {JSON.stringify(event.data, null, 2)}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {events.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50 space-y-2">
                  <Activity size={32} />
                  <p>Waiting for events...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-2xl shadow-orange-100 border border-gray-100 p-10"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center shadow-xl shadow-orange-200 mx-auto mb-6">
            <Activity className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-1">SyncOrder</h1>
          <p className="text-gray-500 text-sm font-medium">Real-time event synchronization</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Email Address</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-xs font-medium">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 text-white py-3.5 rounded-xl font-bold text-sm hover:bg-orange-600 transition-all shadow-lg shadow-orange-200 disabled:opacity-50"
          >
            {loading ? 'Processing...' : (isRegister ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-4 text-gray-400 font-bold tracking-widest">Or</span>
          </div>
        </div>

        <button 
          onClick={onLogin}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 py-3 rounded-xl font-bold text-gray-600 hover:border-orange-500 hover:bg-orange-50 transition-all text-sm shadow-sm"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
          Continue with Google
        </button>

        <p className="mt-8 text-center text-sm text-gray-500">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button 
            onClick={() => setIsRegister(!isRegister)}
            className="text-orange-600 font-bold hover:underline"
          >
            {isRegister ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}

function CustomerDashboard({ orders, menuItems, onCreateOrder, user }: { orders: Order[], menuItems: MenuItem[], onCreateOrder: (name: string, items: any[]) => void, user: User }) {
  const [cart, setCart] = useState<any[]>([]);

  const addToCart = (item: any) => setCart([...cart, item]);
  const removeFromCart = (index: number) => setCart(cart.filter((_, i) => i !== index));

  const handlePlaceOrder = () => {
    if (cart.length === 0) return;
    onCreateOrder(user.displayName || 'Anonymous', cart);
    setCart([]);
  };

  const myOrders = orders.filter(o => o.customerUid === user.uid);

  return (
    <div className="space-y-8">
      {/* Menu Section */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <ShoppingBag className="text-orange-500" />
          <h2 className="text-2xl font-bold tracking-tight">Place an Order</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {menuItems.map((item) => (
            <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-between group hover:border-orange-500 transition-all hover:shadow-md">
              <div>
                <h3 className="font-bold text-gray-900">{item.name}</h3>
                <p className="text-orange-600 font-semibold">₹{item.price.toFixed(2)}</p>
              </div>
              <button 
                onClick={() => addToCart(item)}
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-orange-500 hover:text-white transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
          ))}
          {menuItems.length === 0 && (
            <div className="col-span-full text-center py-12 bg-white rounded-2xl border border-dashed border-gray-300 text-gray-400">
              The menu is currently empty.
            </div>
          )}
        </div>
      </section>

      {/* Cart Section */}
      {cart.length > 0 && (
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-2xl border-2 border-orange-500 shadow-xl shadow-orange-100"
        >
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            Your Selection ({cart.length})
          </h3>
          <div className="space-y-3 mb-6">
            {cart.map((item, i) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <span className="text-gray-600">{item.name}</span>
                <div className="flex items-center gap-4">
                  <span className="font-bold">₹{item.price.toFixed(2)}</span>
                  <button onClick={() => removeFromCart(i)} className="text-red-500 hover:text-red-700">Remove</button>
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-gray-100 flex justify-between items-center font-bold text-lg">
              <span>Total</span>
              <span className="text-orange-600">₹{cart.reduce((s, i) => s + i.price, 0).toFixed(2)}</span>
            </div>
          </div>
          
          <button 
            onClick={handlePlaceOrder}
            className="w-full bg-orange-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-orange-600 transition-all shadow-lg shadow-orange-200"
          >
            Confirm Order
          </button>
        </motion.section>
      )}

      {/* Tracking Section */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <Clock className="text-orange-500" />
          <h2 className="text-2xl font-bold tracking-tight">Your Active Orders</h2>
        </div>
        
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {myOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </AnimatePresence>
          {myOrders.length === 0 && (
            <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-300 text-gray-400">
              No orders placed yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminDashboard({ orders, onUpdateStatus }: { orders: Order[], onUpdateStatus: (id: string, s: OrderStatus) => void }) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-orange-500" />
          <h2 className="text-2xl font-bold tracking-tight">Order Management</h2>
        </div>
        <div className="flex gap-4 text-xs font-bold uppercase tracking-widest text-gray-400">
          <span>Total: {orders.length}</span>
          <span>Active: {orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <AnimatePresence mode="popLayout">
          {orders.map((order) => (
            <motion.div 
              layout
              key={order.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-bold text-gray-400">#{order.id.slice(-6)}</span>
                  <h4 className="font-bold text-lg">{order.customerName}</h4>
                </div>
                <p className="text-sm text-gray-500">
                  {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                </p>
                <p className="text-xs text-gray-400">Placed at {new Date(order.createdAt).toLocaleTimeString()}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusButton 
                  current={order.status} 
                  target="pending" 
                  onClick={() => onUpdateStatus(order.id, 'pending')}
                  icon={<Clock size={14} />}
                />
                <StatusButton 
                  current={order.status} 
                  target="preparing" 
                  onClick={() => onUpdateStatus(order.id, 'preparing')}
                  icon={<ChefHat size={14} />}
                />
                <StatusButton 
                  current={order.status} 
                  target="ready" 
                  onClick={() => onUpdateStatus(order.id, 'ready')}
                  icon={<ShoppingBag size={14} />}
                />
                <StatusButton 
                  current={order.status} 
                  target="delivered" 
                  onClick={() => onUpdateStatus(order.id, 'delivered')}
                  icon={<Truck size={14} />}
                />
                <StatusButton 
                  current={order.status} 
                  target="cancelled" 
                  onClick={() => onUpdateStatus(order.id, 'cancelled')}
                  icon={<AlertCircle size={14} />}
                  variant="danger"
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatusButton({ current, target, onClick, icon, variant = 'primary' }: { 
  current: OrderStatus, 
  target: OrderStatus, 
  onClick: () => void,
  icon: React.ReactNode,
  variant?: 'primary' | 'danger',
  key?: string
}) {
  const isActive = current === target;
  
  return (
    <button 
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all border",
        isActive 
          ? (variant === 'danger' ? "bg-red-500 text-white border-red-600 shadow-md" : "bg-orange-500 text-white border-orange-600 shadow-md")
          : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
      )}
    >
      {icon}
      {target.toUpperCase()}
    </button>
  );
}

function MenuManagement({ menuItems, onAdd, onUpdate, onDelete, onSeed }: { 
  menuItems: MenuItem[], 
  onAdd: (n: string, p: number) => void,
  onUpdate: (id: string, n: string, p: number) => void,
  onDelete: (id: string) => void,
  onSeed: () => void
}) {
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPrice) return;
    onAdd(newName, parseFloat(newPrice));
    setNewName('');
    setNewPrice('');
  };

  const startEdit = (item: MenuItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(item.price.toString());
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editName || !editPrice) return;
    onUpdate(editingId, editName, parseFloat(editPrice));
    setEditingId(null);
  };

  return (
    <div className="space-y-8">
      <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <h3 className="font-bold text-lg mb-4">Add New Item</h3>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-4">
          <input 
            type="text" 
            placeholder="Item Name" 
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
          />
          <input 
            type="number" 
            step="0.01"
            placeholder="Price" 
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="w-32 px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
          />
          <button type="submit" className="bg-orange-500 text-white px-6 py-2 rounded-xl font-bold hover:bg-orange-600 transition-all">
            Add Item
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
          <h3 className="font-bold text-sm uppercase tracking-tight">Current Menu</h3>
          {menuItems.length === 0 && (
            <button onClick={onSeed} className="text-xs text-orange-600 font-bold hover:underline">
              Seed Default Menu
            </button>
          )}
        </div>
        <div className="divide-y divide-gray-100">
          {menuItems.map((item) => (
            <div key={item.id} className="p-4 flex items-center justify-between group">
              {editingId === item.id ? (
                <form onSubmit={handleUpdate} className="flex-1 flex gap-4">
                  <input 
                    type="text" 
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 px-3 py-1 rounded-lg border border-orange-200 focus:ring-2 focus:ring-orange-500 outline-none text-sm"
                  />
                  <input 
                    type="number" 
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-24 px-3 py-1 rounded-lg border border-orange-200 focus:ring-2 focus:ring-orange-500 outline-none text-sm"
                  />
                  <button type="submit" className="text-green-600 font-bold text-sm">Save</button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-gray-400 font-bold text-sm">Cancel</button>
                </form>
              ) : (
                <>
                  <div>
                    <h4 className="font-bold text-gray-900">{item.name}</h4>
                    <p className="text-orange-600 font-semibold text-sm">₹{item.price.toFixed(2)}</p>
                  </div>
                  <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(item)} className="text-blue-500 hover:text-blue-700 text-sm font-bold">Edit</button>
                    <button onClick={() => onDelete(item.id)} className="text-red-500 hover:text-red-700 text-sm font-bold">Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {menuItems.length === 0 && (
            <div className="p-12 text-center text-gray-400 text-sm italic">
              No items in menu.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function OrderCard({ order }: { order: Order, key?: string }) {
  const statusConfig = {
    pending: { color: 'bg-gray-100 text-gray-600', icon: <Clock size={16} />, label: 'Order Received' },
    preparing: { color: 'bg-blue-100 text-blue-600', icon: <ChefHat size={16} />, label: 'In Kitchen' },
    ready: { color: 'bg-purple-100 text-purple-600', icon: <ShoppingBag size={16} />, label: 'Ready for Pickup' },
    delivered: { color: 'bg-green-100 text-green-600', icon: <CheckCircle2 size={16} />, label: 'Delivered' },
    cancelled: { color: 'bg-red-100 text-red-600', icon: <AlertCircle size={16} />, label: 'Cancelled' },
  };

  const config = statusConfig[order.status];

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm group hover:border-orange-200 transition-all"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono font-bold text-gray-400">#{order.id.slice(-6)}</span>
            <h4 className="font-bold text-gray-900">{order.customerName}</h4>
          </div>
          <p className="text-xs text-gray-500">{order.items.length} items • ₹{order.total.toFixed(2)}</p>
        </div>
        <div className={cn("px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 uppercase tracking-wider", config.color)}>
          {config.icon}
          {config.label}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ 
            width: order.status === 'pending' ? '25%' : 
                   order.status === 'preparing' ? '50%' : 
                   order.status === 'ready' ? '75%' : 
                   order.status === 'delivered' ? '100%' : '0%'
          }}
          className={cn(
            "absolute top-0 left-0 h-full transition-all duration-1000",
            order.status === 'cancelled' ? 'bg-red-500' : 'bg-orange-500'
          )}
        />
      </div>
    </motion.div>
  );
}
