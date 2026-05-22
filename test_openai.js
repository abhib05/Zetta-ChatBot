const openaiService = require('./src/services/openai');
const config = require('./src/config');

async function test() {
  const dbCache = {
    plots: [{plot_code: 'A'}],
    allCrops: [{crop_name: 'Wheat'}],
    machines: [{machine_name: 'Tractor'}]
  };
  
  const transcript = "Activity [land_preparation]: Ploughed plot A with Tractor for 60 mins";
  
  console.log("Calling OpenAI API...");
  try {
    const parsed = await openaiService.parseActivities(transcript, dbCache);
    console.log("Parsed result:", parsed);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
