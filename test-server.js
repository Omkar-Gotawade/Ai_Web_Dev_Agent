async function testServer() {
  try {
    // Test health endpoint
    console.log('Testing GET /...');
    let healthRes = await fetch('http://localhost:5000/');
    let healthData = await healthRes.json();
    console.log('✅ GET / response:', healthData);

    // Test generate endpoint
    console.log('\nTesting POST /generate...');
    let generateRes = await fetch('http://localhost:5000/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a simple landing page with a hero section and a CTA button'
      })
    });
    let generateData = await generateRes.json();
    console.log('✅ POST /generate response:', generateData);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testServer();
