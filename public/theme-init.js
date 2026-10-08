// This switches the theme before the page is rendered, to avoid a flash of the wrong theme
// It runs once in index.html as is run as <script> before the app starts
const t = localStorage.getItem('theme');
if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
}
