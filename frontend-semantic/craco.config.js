module.exports = {
  style: {
    postcss: {
      loaderOptions: (postcssLoaderOptions) => {
        // Replace CRA's default PostCSS plugins entirely.
        // @tailwindcss/postcss handles imports & autoprefixing internally.
        postcssLoaderOptions.postcssOptions.plugins = [
          require("@tailwindcss/postcss"),
        ];
        return postcssLoaderOptions;
      },
    },
  },
};
