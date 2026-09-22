export default {
  name: 'MarketDesk',
  output: './allure-report',
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
