import { OpenRouter } from '@openrouter/sdk';

export type AccountClass = 'male' | 'female' | 'business';

const accountClasses: AccountClass[] = ['male', 'female', 'business'];

export function openRouterClient(): OpenRouter {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is missing from the server environment');
  return new OpenRouter({ apiKey });
}

/** Pick the highest-scored category from Jev's three choices. */
export async function classifyAccount(client: OpenRouter, record: {
  username: string; fullName: string; pictureDescription?: string;
}): Promise<AccountClass> {
  const response = await client.alpha.decisions.create({ decisionsRequest: {
    model: 'typesafe/jev-1.13',
    state: { description: 'An Instagram account, using only its public profile metadata.', record },
    questions: { account_type: {
      type: 'choice',
      instructions: 'Choose the best-fitting category from these three options. Business takes priority over the apparent gender of an owner. Always choose one category, even when evidence is limited.',
      criteria: {
        male: 'A personal account clearly presenting as a man, with no indication that the account represents a business.',
        female: 'A personal account clearly presenting as a woman, with no indication that the account represents a business.',
        business: 'A brand, shop, organization, company, commercial service, or professional business account.',
      },
    } },
  } });
  const answer = response.answers.account_type;
  if (!answer || answer.type !== 'choice') throw new Error('Jev returned no account classification');
  const scores = accountClasses.map(category => ({ category, score: answer.probabilities?.[category] }));
  const scored = scores.filter((item): item is { category: AccountClass; score: number } =>
    typeof item.score === 'number' && Number.isFinite(item.score));
  if (scored.length === accountClasses.length)
    return scored.reduce((best, item) => item.score > best.score ? item : best).category;
  if (accountClasses.includes(answer.choice as AccountClass)) return answer.choice as AccountClass;
  throw new Error(`Jev returned an invalid account classification: ${answer.choice}`);
}
