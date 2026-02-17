import { writeFileSync } from "fs";

const API_KEY = '<API-KEY>'; // Set this in your environment
const BASE_URL = "https://api.cartesia.ai/voices";

async function fetchAllVoices() {
  try {
    if (!API_KEY) {
      throw new Error("Missing CARTESIA_API_KEY environment variable.");
    }

    const data = [];
    let hasMore = false;
    let nextPage = null;
    do {
      let url = `${BASE_URL}?limit=100`;
      if (nextPage) {
        url += `&starting_after=${nextPage}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Cartesia-Version": "2025-04-16"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const voicesData = await response.json();
      data.push(...voicesData.data);
      hasMore = voicesData.has_more;
      nextPage = voicesData.next_page;
    }
    while (hasMore);

    const voices = data.map(voice => ({
      id: voice.id,
      displayName: voice.name,
      description: voice.description,
      gender: voice.gender
        ? voice.gender === 'feminine'
          ? 'female'
          : voice.gender === 'masculine'
            ? 'male'
            : 'neutral'
        : 'neutral',
      languages: [voice.language],
    }));

    writeFileSync("voices2.json", JSON.stringify(voices, null, 2));

    console.log(`✅ Successfully saved ${data.length || 0} voices to voices.json`);
  } catch (error) {
    console.error("❌ Error fetching voices:", error.message);
  }
}

fetchAllVoices();
