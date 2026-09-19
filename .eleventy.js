module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("bundle.css");
  eleventyConfig.addPassthroughCopy('src/11ty/assets/bus-sq.png');

  eleventyConfig.ignores.add('src/11ty/_site/**');

  return {
    dir: {
      input: 'src/11ty',
      output: 'docs',
      data: '_data',
      includes: '_includes',
      layouts: '_layouts'
    }
  };
};
