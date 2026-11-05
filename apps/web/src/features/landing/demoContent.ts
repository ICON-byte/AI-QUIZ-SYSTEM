// Authored public examples only. Never import account data or private source material.
export const sample = {
  title: 'A smaller search, every time.',
  passage:
    'Binary search requires sorted input. Each comparison eliminates half of the remaining search interval.',
  quote: 'Binary search requires sorted input.',
  question: 'What does binary search require?',
  options: [
    'Sorted input',
    'Only positive numbers',
    'An even number of items',
    'No repeated values',
  ],
  correct: 0,
  explanation:
    'The input must be sorted so a comparison can determine which half to discard. The values do not need to be positive, unique, or even in number.',
} as const;

export const questions = [
  {
    question: 'Can I use my own lecture material?',
    answer:
      'Yes. Generate questions from a topic or from reviewed text extracted from PDF, DOCX or TXT files. You can also write questions manually and import them into a question bank using CSV.',
  },
  {
    question: 'Should I check AI-generated questions?',
    answer:
      'Always. Review the question, four options, correct answer and explanation before keeping it. A matching source excerpt helps you inspect the connection; it does not guarantee that a question is factually correct.',
  },
  {
    question: 'What happens to material used with AI?',
    answer:
      'Your topic or reviewed document text is sent to Google Gemini’s free service. Google may use inputs and responses for product improvement, including human review. Use non-sensitive educational material only. Never submit confidential exam material or private student information.',
  },
  {
    question: 'Who can create official assessments?',
    answer:
      'Verified lecturers can create courses, enroll students and publish official assessments. Lecturer registration starts the account; an authorized operator must verify it before official assessment access is enabled.',
  },
  {
    question: 'Do friends need to be online together?',
    answer:
      'No. Students join with an invitation and take the challenge in their own time while it is open. Each participant gets one attempt. Creators cannot enter their own ranked challenge, and answers are revealed only after closure.',
  },
  {
    question: 'Who is the application for?',
    answer:
      'The initial audience is university students and lecturers aged 18 and above in Nigeria. Registration includes an age confirmation. AI generation is subject to configured usage limits and provider availability.',
  },
];
