const express = require('express');
const bodyParser = require('body-parser');

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const cors = require('cors');

// MySQL2
const mysql = require('mysql2/promise');

const app = express();

// importing .env file
require('dotenv').config();

const port = process.env.PORT || 4500;

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'backend_final'
});

app.use(async function mysqlConnection(req, res, next) {
  try {
    req.db = await pool.getConnection();
    req.db.connection.config.namedPlaceholders = true;

    await req.db.query('SET SESSION sql_mode = "TRADITIONAL"');
    await req.db.query(`SET time_zone = '-8:00'`);

    await next();

    req.db.release();
  } catch (err) {
 
    console.log(err)
    if (req.db) req.db.release();
    throw err;
  }
});

app.use(cors());

app.use(bodyParser.json());

app.get('/user', async function(req, res) {
  console.log('user route works')
  try {
    const user = {
      name: 'test',
      email: 'test@yahoogmail.com',
      age: 25
    }

    res.json(user);
  } catch(err) {
    console.log('Error in /user', err)
  }
});


// Public endpoints
//Create new user
app.post('/register', async function (req, res) {
  try {
    let user;

    // Hashes the password and inserts the info into the user table in SQL DB
    await bcrypt.hash(req.body.password, 10).then(async hash => {
      try {
        [user] = await req.db.query(`
          INSERT INTO user (name, email, password)
          VALUES (:name, :email, :password);
        `, {
          name: req.body.name,
          email: req.body.email,
          password: hash
        });

        console.log('user', user);
      } catch (error) {
        console.log('error', error);
      }
    });

    const encodedUser = jwt.sign(
      { 
        userId: user.insertId,
        ...req.body
      },
      process.env.JWT_KEY
    );

    res.json(encodedUser);
  } catch (err) {
    console.log('err', err)
  }
});

//logging in 
app.post('/auth', async function (req, res) {
  try {
    const [[user]] = await req.db.query(`
      SELECT * FROM user WHERE email = :email
    `, {  
      email: req.body.email,
    });

    if (!user) {
      res.status(400).json('Email not found');
    }

    console.log('user', user)

    const userPassword = `${user.password}`;

    console.log('userPassword', userPassword);
    console.log('required password:', req.body.password);
    const compare = await bcrypt.compare(req.body.password, userPassword);
    console.log('compare', compare);

    if (compare) {
      const payload = {
        userId: user.id,
        email: user.email,
        name: user.name
      }
      
      const encodedUser = jwt.sign(payload, process.env.JWT_KEY);

      res.json(encodedUser)
    } else {
      res.status(400).json('Password not found');
    }
  } catch (err) {
    console.log('Error in /auth', err)
  }
})

//fetching products
app.get('/products', async (req, res)=> {
  try {
    const [products] = await req.db.query('SELECT * FROM products');
    res.json(products);
    console.log('Public products endpoint')
  }catch(err){
    console.log(err)
  }
});
//fetching product brands
app.get('/product-brands', async (req, res)=> {
  try{
    const [brands] = await req.db.query('SELECT * FROM brands');
    res.json(brands);
  }catch(err){
    console.log(err);
  }
});
//fetching product categories 
app.get('/product-categories', async (req,res)=> {
  try{
    const [categories] = await req.db.query('SELECT * FROM CATEGORIES');
    res.json(categories);
  }catch(err){
    console.log(err);
  }
});
 // Jwt verification checks to see if there is an authorization header with a valid jwt in it.
app.use(async function verifyJwt(req, res, next) {
  if (!req.headers.authorization) {
    throw(401, 'Invalid authorization');
  }

  const [scheme, token] = req.headers.authorization.split(' ');

  console.log('[scheme, token]', scheme, ' ', token);

  if (scheme !== 'Bearer') {
    throw(401, 'Invalid authorization');
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_KEY);

    console.log('payload', payload)

    req.user = payload;
  } catch (err) {
    if (err.message && (err.message.toUpperCase() === 'INVALID TOKEN' || err.message.toUpperCase() === 'JWT EXPIRED')) {

      req.status = err.status || 500;
      req.body = err.message;
      req.app.emit('jwt-error', err, req);
    } else {

      throw((err.status || 500), err.message);
    }
    console.log(err)
  }

  await next();
});

//Private endpoints

//fetching user's favorite products and notes
app.get('/user-products', async (req, res) => {
  try {
    const [list] = await req.db.query(`
    SELECT * FROM products
    INNER JOIN user_products
     ON user_products.product_id = products.id
     WHERE user_id = :user_id`,
      {
        user_id: req.user.userId
      }
    );
    res.json(list);
    console.log('/user-products', list);
  } catch (err) {
    console.log(err);
  }
});
//adding a product for a user's list of favorites
app.post('/user-products', async(req,res)=> {
  try {
    const [list] = await req.db.query(`
    INSERT INTO user_products(user_id, product_id) VALUES (:user_id, :product_id)`
    ,{
      user_id: req.user.userId,
      product_id: req.body.product_id
    });
    res.json(list)
  } catch(err){
    console.log(err);
  }
});
//adding user notes
app.post('/notes', async(req, res)=> {
  try{
    const[notes] = await req.db.query(`
    INSERT INTO notes(note,user_id) VALUES (:note, :user_id)`, {
      note: req.body.note,
      user_id: req.user.userId
    });
    res.json(notes);
  }catch(err){
    console.log(err);
  }
});
//updating a product for a user's list of favorites 
app.put('/user-products/:id', async(req, res)=> {
  const [list] = await req.db.query (`
  UPDATE user_products SET product_id = :product_id WHERE id = :id`,
  {
    product_id : req.body.product_id,
    id: req.params.id
  });
  res.json(list);
});

app.put('/note/:id', async(req, res)=> {
  const [notes] = await req.db.query (`
  UPDATE notes SET note = :note WHERE id = :id`,
  {
    note: req.body.note,
    id: req.params.id
  })
  res.json(notes);
});
//remove a product from a user's list of favorites
app.delete('/user-products/:id', async (req, res)=> {
  const[product] = await req.db.query(`
  DELETE FROM user_products WHERE id = :id `, 
  {
    id: req.params.id
  }
  );
  res.json(product)
});
//removes user note
app.delete('/note/:id', async (req, res)=> {
  const [note] = await req.db.query(`
  DELETE FROM notes WHERE id = :id`, {
    id: req.params.id
  })
  res.json(note);
})
app.listen(port, () => console.log(`Demo app listening at http://localhost:${port}`));