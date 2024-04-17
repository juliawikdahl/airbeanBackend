const express = require('express');
const Datastore = require('nedb');
const menuData = require('./menu.json');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

const menu = menuData.menu;

const db = new Datastore({ filename: 'users.db', autoload: true });

app.use(express.json());

app.get('/menu', (req, res) => {
    res.status(200).json(menu);
});

app.post('/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Mail och lösenord måste anges.' });
    }

    db.findOne({ email }, (err, existingUser) => {
        if (err) {
            return res.status(500).json({ error: 'Något gick fel vid databasåtkomst.' });
        }
        if (existingUser) {
            return res.status(409).json({ error: 'Användaren finns redan.' });
        }

        const userId = uuidv4();
        const newUser = {
            id: userId,
            email,
            password,
            orders: [],
            cart: []
        };
        db.insert(newUser, (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Kunde inte skapa användarkonto.' });
            }
            res.status(201).json({ message: 'Användarkonto skapat.' });
        });
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Mail och lösenord måste anges.' });
    }

    db.findOne({ email }, (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Ett fel uppstod vid inloggning.' });
        }
        if (!user) {
            return res.status(404).json({ error: 'Användaren hittades inte.' });
        }
        if (user.password !== password) {
            return res.status(401).json({ error: 'Fel lösenord.' });
        }
        res.status(200).json({ userId: user.id });
    });
});

app.post('/cart/add', (req, res) => {  
    const { userId, itemId } = req.body;

    db.findOne({ id: userId }, (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Användaren hittades inte.' });
        }

        const menuItem = menu.find(item => item.id === parseInt(itemId));

        if (!menuItem) {
            return res.status(404).json({ error: 'Produkten finns inte i menyn.' });
        }

        const existingItemIndex = user.cart.findIndex(item => item.itemId === parseInt(itemId));

        if (existingItemIndex !== -1) {
            user.cart[existingItemIndex].quantity++;
        } else {
            user.cart.push({ itemId: parseInt(itemId), quantity: 1 });
        }

        db.update({ id: userId }, { $set: { cart: user.cart } }, {}, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Kunde inte uppdatera varukorgen.' });
            }
            res.status(200).json({ message: 'Produkten har lagts till i varukorgen.' });
        });
    });
});

app.post('/cart/remove', (req, res) => {
    const { userId, itemId } = req.body;

    db.update({ id: userId }, { $pull: { cart: { id: itemId } } }, {}, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Kunde inte ta bort kaffesort från varukorgen.' });
      }
      res.status(200).json({ message: 'Kaffesorten har tagits bort från varukorgen.' });
    });
});

app.get('/about', (req, res) => {
    res.send('Här kan du läsa om företaget och dess kaffe.');
});

app.get('/cart/:userId', (req, res) => {
    const userId = req.params.userId;

    db.findOne({ id: userId }, (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Användaren hittades inte.' });
        }
        const cart = user.cart;

        const uniqueCart = [];
        cart.forEach(item => {
            const existingItemIndex = uniqueCart.findIndex(uniqueItem => uniqueItem.id === item.id);
            if (existingItemIndex !== -1) {
                uniqueCart[existingItemIndex].quantity += 1;
            } else {
                uniqueCart.push({ id: item.id, title: item.title, desc: item.desc, price: item.price, quantity: 1 });
            }
        });

        const totalPrice = uniqueCart.reduce((acc, item) => {
            return acc + (item.price * item.quantity);
        }, 0);

        res.status(200).json({ cart: uniqueCart, totalPrice });
    });
});

const ordersDB = new Datastore({ filename: 'orders.db', autoload: true });
const guestOrdersDB = new Datastore({ filename: 'guest_orders.db', autoload: true });

app.post('/order', (req, res) => {
    const { userId, items } = req.body;

    const orderId = userId ? undefined : generateOrderId();

    const newOrder = {
        orderId,
        userId,
        items,
        status: 'På väg',
        estimatedDeliveryTime: generateEstimatedDeliveryTime(),
        timestamp: new Date()
    };

    if (userId) {
        ordersDB.insert(newOrder, (err, order) => {
            if (err) {
                return res.status(500).json({ error: 'Kunde inte skapa beställning.' });
            }
           
            res.status(200).json({ status: order.status, estimatedDeliveryTime: order.estimatedDeliveryTime, timestamp: order.timestamp });
        });
    } else {
        guestOrdersDB.insert(newOrder, (err, order) => {
            if (err) {
                return res.status(500).json({ error: 'Kunde inte skapa gästbeställning.' });
            }
            res.status(200).json({ orderId: order.orderId, status: order.status, estimatedDeliveryTime: order.estimatedDeliveryTime, timestamp: order.timestamp });
        });
    }
});

function generateEstimatedDeliveryTime() {
    const minDeliveryMinutes = 5;
    const maxDeliveryMinutes = 20;
    const deliveryTimeMinutes = Math.floor(Math.random() * (maxDeliveryMinutes - minDeliveryMinutes + 1)) + minDeliveryMinutes;
    return deliveryTimeMinutes;
}

function generateOrderId() {
    return Math.random().toString(36).substr(2, 9); 
}

app.get('/orders/:userId', (req, res) => {
    const userId = req.params.userId;

    ordersDB.find({ userId }, (err, orders) => {
        if (err) {
            return res.status(500).json({ error: 'Något gick fel vid hämtning av användarordrar.' });
        }

        if (!orders || orders.length === 0) {
            return res.status(404).json({ message: 'Inga order hittades för den angivna användaren.' });
        }
        orders.forEach(order => {
            updateOrderStatus(order);
        });

        const ordersWithTotalPrice = orders.map(order => {
            if (order.items && order.items.length > 0) {
                const totalPrice = order.items.reduce((acc, item) => {
                    return acc + (item.price * item.quantity);
                }, 0);
                return { ...order, totalPrice };
            } else {
                return { ...order, totalPrice: 0 };
            }
        });

        res.status(200).json(ordersWithTotalPrice);
    });
});

function updateOrderStatus(order) {
    const currentTime = new Date();
    const deliveryTime = new Date(order.estimatedDeliveryTime);

    if (currentTime > deliveryTime) {
        order.status = 'Levererad';
    } else {
        order.status = 'På väg';
    }
}

app.listen(port, () => {
  console.log(`Servern lyssnar på port ${port}`);
});
