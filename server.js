const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const dotenv = require('dotenv');

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is not set. Project management and exports work, but AI generation is disabled.');
}

const { ensureDatabase } = require('./src/db/init');
const projectsRouter = require('./src/routes/projects');
const filesRouter = require('./src/routes/files');
const generationRouter = require('./src/routes/generation');
const chaptersRouter = require('./src/routes/chapters');
const exportRouter = require('./src/routes/export');

ensureDatabase();

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.set('layout', 'layout');

app.use(expressLayouts);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/public/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css')));
app.use('/public/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'js')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/exports', express.static(path.join(__dirname, 'exports')));

app.use((req, res, next) => {
  res.locals.appName = 'BookForge AI';
  res.locals.messages = {
    success: req.query.success,
    error: req.query.error
  };
  next();
});

app.get('/', (req, res) => res.redirect('/projects'));
app.use('/projects', projectsRouter);
app.use('/projects/:projectId/files', filesRouter);
app.use('/projects/:projectId/generation', generationRouter);
app.use('/projects/:projectId/chapters', chaptersRouter);
app.use('/projects/:projectId/export', exportRouter);

app.use((err, req, res, next) => {
  console.error(err);
  const message = encodeURIComponent(err.message || 'Unexpected server error');
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(500).json({ error: err.message });
  }
  return res.redirect(req.get('referer') || `/projects?error=${message}`);
});

app.listen(port, () => {
  console.log(`BookForge AI running at http://localhost:${port}`);
});
