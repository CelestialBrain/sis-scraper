/**
 * Tests for SupabaseManager
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { SupabaseManager, ALL_DEPARTMENTS_LABEL } from '../src/supabase.js';

describe('SupabaseManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SupabaseManager({
      ingestToken: 'test-token',
      ingestEndpoint: 'https://example.com/ingest',
      batchSize: 10,
      concurrency: 2
    });
  });

  test('should initialize with correct configuration', () => {
    expect(manager.batchSize).toBe(10);
    expect(manager.concurrency).toBe(2);
    expect(manager.isEnabled()).toBe(true);
  });

  test('should be disabled without token or endpoint', () => {
    const disabled = new SupabaseManager({});
    expect(disabled.isEnabled()).toBe(false);
  });

  test('should transform schedule data correctly', () => {
    const input = [
      {
        term_code: '2024-1',
        program: 'BS Computer Science',
        year: 1,
        semester: '1st Semester',
        code: 'CS 101',
        title: 'Introduction to Programming',
        units: 3
      },
      {
        term_code: '2024-1',
        program: 'BS Mathematics',
        year: 2,
        semester: '2nd Semester',
        code: 'MATH 201',
        title: 'Calculus II',
        units: 4
      }
    ];

    const result = manager.transformScheduleData(input);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      term_code: '2024-1',
      program: 'BS Computer Science',
      year: 1,
      semester: '1st Semester',
      course_code: 'CS 101',
      course_title: 'Introduction to Programming',
      units: 3,
      department: 'CS',
      level: 1
    });
    expect(result[1]).toMatchObject({
      course_code: 'MATH 201',
      department: 'MATH'
    });
  });

  test('should extract department from course code', () => {
    expect(manager._extractDepartment('CS 101')).toBe('CS');
    expect(manager._extractDepartment('MATH 201')).toBe('MATH');
    expect(manager._extractDepartment('BIO100')).toBe('BIO');
    expect(manager._extractDepartment('SocWk 1130')).toBe('SOCWK');
    expect(manager._extractDepartment('')).toBe('UNKNOWN');
    expect(manager._extractDepartment(null)).toBe('UNKNOWN');
  });

  test('should handle records without term_code', () => {
    const input = [{
      code: 'CS 101',
      title: 'Test',
      units: 3
    }];

    const result = manager.transformScheduleData(input);
    expect(result[0].term_code).toBe('');
  });

  test('should return correct ALL_DEPARTMENTS_LABEL constant', () => {
    expect(ALL_DEPARTMENTS_LABEL).toBe('All Departments');
  });

  describe('university_code support', () => {
    test('should default university_code to ADDU when not provided', () => {
      const defaultManager = new SupabaseManager({
        ingestToken: 'test-token',
        ingestEndpoint: 'https://example.com/ingest'
      });
      expect(defaultManager.universityCode).toBe('ADDU');
    });

    test('should use custom university_code from options', () => {
      const customManager = new SupabaseManager({
        ingestToken: 'test-token',
        ingestEndpoint: 'https://example.com/ingest',
        universityCode: 'ADMU'
      });
      expect(customManager.universityCode).toBe('ADMU');
    });

    test('should include university_code in transformed schedule data', () => {
      const input = [{
        term_code: '2024-1',
        program: 'BS Computer Science',
        year: 1,
        semester: '1st Semester',
        code: 'CS 101',
        title: 'Introduction to Programming',
        units: 3
      }];

      const result = manager.transformScheduleData(input);

      expect(result[0].university_code).toBe('ADDU');
    });

    test('should include custom university_code in transformed schedule data', () => {
      const customManager = new SupabaseManager({
        ingestToken: 'test-token',
        ingestEndpoint: 'https://example.com/ingest',
        universityCode: 'ADMU'
      });

      const input = [{
        term_code: '2024-1',
        program: 'BS Information Technology',
        year: 2,
        semester: '1st Semester',
        code: 'IT 201',
        title: 'Web Development',
        units: 3
      }];

      const result = customManager.transformScheduleData(input);

      expect(result[0].university_code).toBe('ADMU');
    });
  });
});
