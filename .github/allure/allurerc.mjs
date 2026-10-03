export default {
  name: 'MarketDesk',
  output: './allure-report',
  historyPath: './allure-history/history.jsonl',
  historyLimit: 20,
  plugins: {
    awesome: {
      options: {
        reportName: 'MarketDesk test report',
        singleFile: false,
        reportLanguage: 'en',
        groupBy: ['epic', 'feature', 'story'],
      },
    },
  },
};
