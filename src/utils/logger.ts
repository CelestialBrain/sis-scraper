/**
 * Logger utility with colored output
 */

import chalk from 'chalk';

const DEBUG = process.env.DEBUG_SCRAPER === 'true';

export const logger = {
  info(tag: string, message: string): void {
    console.log(chalk.blue(`[${tag}]`) + ` ${message}`);
  },

  success(tag: string, message: string): void {
    console.log(chalk.green(`[${tag}]`) + ` ${message}`);
  },

  warn(tag: string, message: string): void {
    console.warn(chalk.yellow(`[${tag}]`) + ` ${message}`);
  },

  error(tag: string, message: string): void {
    console.error(chalk.red(`[${tag}]`) + ` ${message}`);
  },

  debug(tag: string, message: string): void {
    if (DEBUG) {
      console.log(chalk.gray(`[${tag}]`) + ` ${message}`);
    }
  },

  step(step: string, message: string): void {
    console.log(`\n${chalk.cyan(step)} ${message}`);
  },

  divider(): void {
    console.log('='.repeat(60));
  },
};
