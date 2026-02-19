import * as azureSDK from 'microsoft-cognitiveservices-speech-sdk';
import { writeFileSync } from 'fs';

/**
 * Script to fetch all available Azure neural voices using the Azure Speech SDK
 * 
 * Prerequisites:
 * - Set SUBSCRIPTION_KEY constant with your Azure Speech subscription key
 * - Set REGION constant with your Azure region (e.g., "eastus", "westeurope")
 * 
 * Usage:
 * tsx src/scripts/fetch-azure-voices.ts
 * 
 * Output:
 * Creates azure-voices.json file with all available neural voices formatted for the provider catalog
 */

const SUBSCRIPTION_KEY = "<key>"; // Replace with your Azure Speech subscription key
const REGION = "<region>"; // Replace with your Azure region (e.g., "eastus", "westeurope")

async function fetchAzureVoices() {
  try {
    if (!SUBSCRIPTION_KEY) {
      throw new Error('Missing SUBSCRIPTION_KEY constant. Please set it to your Azure Speech subscription key.');
    }

    if (!REGION) {
      throw new Error('Missing REGION constant. Please set it to your Azure region (e.g., "eastus", "westeurope").');
    }

    console.log(`🔄 Fetching Azure neural voices from region: ${REGION}...`);

    // Create Speech configuration
    const speechConfig = azureSDK.SpeechConfig.fromSubscription(SUBSCRIPTION_KEY, REGION);

    // Create a synthesizer to get voices (we don't need audio output for this)
    const synthesizer = new azureSDK.SpeechSynthesizer(speechConfig);

    // Fetch available voices (getVoicesAsync returns a Promise)
    const voicesResult = await synthesizer.getVoicesAsync();

    // Close synthesizer
    synthesizer.close();

    if (!voicesResult.voices || voicesResult.voices.length === 0) {
      throw new Error('No voices returned from Azure Speech service');
    }

    console.log(`✅ Found ${voicesResult.voices.length} total voices`);

    writeFileSync('all-azure-voices.json', JSON.stringify(voicesResult.voices, null, 2));
    // Filter for neural voices and map to our format
    const neuralVoices = voicesResult.voices
      .filter((voice: any) => voice.voiceType === 1) // 1 = Neural voice type
      .map((voice: any) => {
        // Extract language code from locale (e.g., "en-US" from voice)
        const locale = voice.locale;

        // Determine gender (1 = Female, 2 = Male)
        let gender: 'male' | 'female' | 'neutral' = 'neutral';
        if (voice.gender === 1) {
          gender = 'female';
        } else if (voice.gender === 2) {
          gender = 'male';
        }

        // Extract short name for display (e.g., "Aria" from "en-US-AriaNeural")
        const shortName = voice.shortName.split('-').pop()?.replace('Neural', '') || voice.shortName;

        // Create display name with language info
        const displayName = `${shortName} (${locale})`;

        // Map voice styles if available
        const styles = voice.styleList || [];
        const description = styles.length > 0
          ? `Supports styles: ${styles.join(', ')}`
          : 'Neural voice with natural prosody';

        return {
          id: voice.shortName,
          displayName,
          description,
          gender,
          languages: [locale],
          styles: styles.length > 0 ? styles : undefined,
        };
      })
      .sort((a: any, b: any) => {
        // Sort by locale first, then by name
        const localeCompare = a.languages[0].localeCompare(b.languages[0]);
        if (localeCompare !== 0) return localeCompare;
        return a.displayName.localeCompare(b.displayName);
      });

    console.log(`✅ Filtered to ${neuralVoices.length} neural voices`);

    // Group by language for statistics
    const byLanguage = neuralVoices.reduce((acc: Record<string, number>, voice: any) => {
      const lang = voice.languages[0];
      acc[lang] = (acc[lang] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📊 Voices by language:');
    Object.entries(byLanguage)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .forEach(([lang, count]) => {
        console.log(`  ${lang}: ${count} voices`);
      });

    // Save to file
    const outputPath = 'azure-voices.json';
    writeFileSync(outputPath, JSON.stringify(neuralVoices, null, 2));

    console.log(`\n✅ Successfully saved ${neuralVoices.length} neural voices to ${outputPath}`);
    console.log('\n💡 To use these voices in the provider catalog:');
    console.log('   1. Review the generated JSON file');
    console.log('   2. Select the most relevant voices for your use case');
    console.log('   3. Add them to the voices array in ProviderCatalogService.ts');
    console.log('   4. Mark recommended voices with recommended: true');

  } catch (error) {
    console.error('❌ Error fetching Azure voices:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the script
fetchAzureVoices();
