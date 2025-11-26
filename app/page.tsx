export default function Home() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>API Next.js</h1>
      <p>Este es un proyecto solo para API.</p>
      <p>
        Prueba el endpoint:{' '}
        <a href="/api/hello" style={{ color: 'blue' }}>
          /api/hello
        </a>
      </p>
    </div>
  );
}

