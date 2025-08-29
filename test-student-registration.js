const { Pool } = require('pg');
require('dotenv').config();

// Test database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/votech',
});

async function testStudentRegistration() {
  try {
    console.log('🧪 Testing Student Registration System...\n');

    // Test 1: Check database connection
    console.log('1. Testing database connection...');
    const client = await pool.connect();
    console.log('✅ Database connection successful\n');

    // Test 2: Check students table structure
    console.log('2. Checking students table structure...');
    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'students' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Students table columns:');
    tableInfo.rows.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    console.log('');

    // Test 3: Check if photo column exists
    const photoColumn = tableInfo.rows.find(col => col.column_name === 'photo');
    if (photoColumn) {
      console.log('✅ Photo column exists in students table');
    } else {
      console.log('❌ Photo column missing - you may need to run the migration');
    }
    console.log('');

    // Test 4: Check existing students
    console.log('3. Checking existing students...');
    const students = await client.query('SELECT COUNT(*) as count FROM students');
    console.log(`📊 Total students in database: ${students.rows[0].count}\n`);

    // Test 5: Check classes and specialties
    console.log('4. Checking related tables...');
    const classes = await client.query('SELECT COUNT(*) as count FROM classes');
    const specialties = await client.query('SELECT COUNT(*) as count FROM specialties');
    console.log(`📚 Total classes: ${classes.rows[0].count}`);
    console.log(`🏢 Total specialties: ${specialties.rows[0].count}\n`);

    // Test 6: Check sample data
    if (parseInt(students.rows[0].count) > 0) {
      console.log('5. Sample student data:');
      const sampleStudent = await client.query('SELECT * FROM students LIMIT 1');
      const student = sampleStudent.rows[0];
      console.log(`   - ID: ${student.id}`);
      console.log(`   - Name: ${student.full_name}`);
      console.log(`   - Student ID: ${student.student_id}`);
      console.log(`   - Class ID: ${student.class_id}`);
      console.log(`   - Specialty ID: ${student.specialty_id}`);
      console.log(`   - Has photo: ${student.photo ? 'Yes' : 'No'}`);
      console.log(`   - Photo URL: ${student.photo_url || 'None'}`);
      console.log('');
    }

    console.log('🎉 All tests completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run the photo migration if needed');
    console.log('   2. Test the API endpoints');
    console.log('   3. Test the frontend form');

    client.release();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// Run the test
testStudentRegistration();
