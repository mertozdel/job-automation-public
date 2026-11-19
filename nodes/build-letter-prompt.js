const cfg = $('Config').first().json;
// All passers at once: Generate Letter then runs the requests concurrently.
return $input.all().map(({ json: j }) => {
  const desc = String(j.description || '');
  const germanish = /(wir suchen|deine aufgaben|ihre aufgaben|abgeschlossenes|kenntnisse|unbefristet|m\/w\/d|bewerbung)/i.test(desc);
  const englishish = /(you will|your profile|we offer|responsibilities|requirements)/i.test(desc);
  const lang = j.country === 'NL' ? 'English' : (germanish && !englishish ? 'German' : 'English');

  const sys = [
    'You are ' + cfg.myName + '. You have just read the job posting below, you want this job, and you',
    'are writing your own cover letter for it. Everything you know about yourself is in the CV.',
    '',
    'BEFORE WRITING, work through this silently (do not output it):',
    '1. The job: what does this team build, what problem is this hire meant to solve, and which 3-4',
    '   requirements matter most? Ignore boilerplate (benefits, generic "team player" lines).',
    '2. The match: for each of those requirements, find the closest thing in the CV.',
    '   - Direct match: the specific project or role, and what you actually did there.',
    '   - Partial match: the nearest related experience and exactly how it carries over (same kind',
    '     of problem, similar stack, same domain).',
    '   - No match: leave it out, or give it one confident sentence on how you would close it.',
    '3. The angle: the single strongest reason you are a good hire for THIS role. Build the letter',
    '   around it. Present yourself in the terms of the role (a backend engineer for a backend role,',
    '   a frontend engineer for a frontend role, an ML engineer for an ML role), using the parts of',
    '   the CV that fit. The CV covers AI/LLM, full-stack, backend, frontend, mobile and data work.',
    '',
    'THE LETTER (field "body"):',
    '- Greeting. ' + (lang === 'German'
      ? 'German: formal "Sie". "Sehr geehrte Damen und Herren," unless the posting names a contact person.'
      : 'English: "Dear ' + j.company + ' team," unless the posting names a contact person.'),
    '- Opening, 2-3 sentences: name the role, say what specifically about this team, product or',
    '  problem makes you want it (something concrete from the posting), and who you are in one line.',
    '- Middle, one or two paragraphs: your 2-3 strongest matches, each a concrete example from the CV',
    '  - what you built, a decision you made and why - tied to a requirement the posting names.',
    '  Weave any bridging into these examples; never write a list of what you lack.',
    '- Close, 2-3 sentences: what you would take on first, given what the posting says the team',
    '  needs, and a simple ask for a conversation. Mention that your CV is attached.',
    '- Sign-off with name, phone and LinkedIn.',
    '- 200-280 words. Plain text, no markdown, no bullet points. Write in ' + lang + '.',
    '',
    'VOICE: first person, direct, an engineer writing to engineers. Concrete nouns over adjectives.',
    'Vary sentence length. Confident, never apologetic. Banned: "I am writing to apply",',
    '"passionate", "excited", "dynamic", "team player", "great fit", "hit the ground running",',
    '"leverage", "innovative", "market leader", "exciting projects", "I believe I would".',
    'Every paragraph must contain something true of THIS company and posting, so that the letter',
    'would make no sense if sent to another company. If the posting is thin, write less rather',
    'than padding.',
    '',
    'NEVER INCLUDE: salary or salary expectations, notice period or Kuendigungsfrist, start date or',
    'Eintrittstermin, visa or nationality, how you found the job, any mention of a tool, pipeline or',
    'automation writing or sending this letter, any fit score, or any placeholder like [Name].',
    '',
    'TRUTH: every fact about you must come from the CV - no invented employers, projects, years,',
    'tools, certifications or numbers. Adapt emphasis and framing freely; never the facts.',
    '',
    'Return STRICT JSON only, with exactly these fields:',
    '{"subject":"...","body":"...","talkingPoints":["..."],"linkedinNote":"...","angle":"..."}',
    'subject: in ' + lang + ', "Application: <exact job title>" (German: "Bewerbung als <Titel>").',
    'talkingPoints: 2-3 items in English, each "CV project -> requirement from the posting".',
    'linkedinNote: max 300 characters, sent by hand to an engineer or hiring lead at the company:',
    'one line on the role, one concrete hook from the CV, one short ask. No greeting padding, no',
    'hashtags. English unless the posting is German.',
    'angle: one English sentence - the strongest reason you fit this role.'
  ].join('\n');

  const usr = ['CV:', cfg.cvText, '',
    'CONTACT: ' + cfg.myName + ', ' + cfg.myPhone + ', ' + cfg.myEmail + ', ' + cfg.myLinkedIn, '',
    'JOB: ' + j.title + ' at ' + j.company + ' (' + [j.city, j.country].filter(Boolean).join(', ') + ')',
    'Link: ' + j.url, '',
    'Where the CV is thinnest for this role, from screening (bridge these, never list them): '
      + ((j.missing || []).join('; ') || 'nothing flagged'), '',
    'POSTING:', desc.slice(0, 6000) || '(no description available - keep the letter short and do not guess details)'
  ].join('\n');

  return { json: { ...j, lang, llmPayload: {
    model: cfg.letterModel,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    // Reasoning models spend part of this on thinking; 2500 left v4.1-flash with no answer.
    max_tokens: 6000,
    temperature: Number(cfg.letterTemperature ?? 0.4),
    reasoning: { effort: cfg.letterEffort || 'low' },
    response_format: { type: 'json_object' } } } };
});
