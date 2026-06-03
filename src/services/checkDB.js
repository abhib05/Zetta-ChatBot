require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const config = {
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_KEY,
};

const supabase = createClient(config.url, config.serviceKey);

async function run() {
  try {
    console.log("Querying employees table schema/columns...");
    const { data, error } = await supabase.from('employees').select('*').limit(1);
    if (error) {
      console.error("Supabase Error:", error);
    } else {
      console.log("Columns present in employees table:", Object.keys(data[0] || {}));
    }
  } catch (err) {
    console.error("Script Error:", err);
  }
}

run();
