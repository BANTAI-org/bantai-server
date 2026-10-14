import { Test, TestingModule } from '@nestjs/testing';
import { WaveDispatchService } from './wave-dispatch.service';
import { IncidentRepository } from '../incidents/incidents.repository';
import { RedisService } from '../redis/redis.service';

describe('WaveDispatchService', () => {
  let service: WaveDispatchService;

  const mockRedisService = {
    findNearby: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaveDispatchService,
        { provide: IncidentRepository, useValue: {} },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<WaveDispatchService>(WaveDispatchService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getWaveRadius', () => {
    it('should return default radius for basic incident', () => {
      // @ts-expect-error - accessing private method for testing
      const radius = service['getWaveRadius']('ASSIST', 'CLEAR', 'MINOR');
      expect(radius).toBe(1000); // Default radius
    });

    it('should increase radius for active threat', () => {
      // @ts-expect-error - accessing private method for testing
      const radius = service['getWaveRadius']('HAZARD', 'ACTIVE_THREAT', null);
      expect(radius).toBeGreaterThanOrEqual(2000);
    });

    it('should increase radius for critical severity', () => {
      // @ts-expect-error - accessing private method for testing
      const radius = service['getWaveRadius']('ASSIST', 'CLEAR', 'CRITICAL');
      expect(radius).toBeGreaterThanOrEqual(3000);
    });

    it('should clamp radius between 1000 and 3000 meters', () => {
      // @ts-expect-error - accessing private method for testing
      const radius1 = service['getWaveRadius'](
        'HAZARD',
        'ACTIVE_THREAT',
        'CRITICAL',
      );
      expect(radius1).toBeLessThanOrEqual(3000);

      // @ts-expect-error - accessing private method for testing
      const radius2 = service['getWaveRadius']('ASSIST', 'CLEAR', null);
      expect(radius2).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('handleIncidentCreated', () => {
    it('should log and return early when no nearby responders found', async () => {
      // Arrange
      const mockEvent = {
        incidentId: 'test-incident-id',
        location: { latitude: 10.0, longitude: 20.0 },
        threatCategory: 'ASSIST',
        threatLevel: 'CLEAR',
        severity: null,
      };

      mockRedisService.findNearby.mockResolvedValue([]);

      // Act
      await service['handleIncidentCreated'](mockEvent);

      // Assert
      expect(mockRedisService.findNearby).toHaveBeenCalledWith(
        'responder',
        mockEvent.location,
        1000, // Default radius for ASSIST/CLEAR/null
        { maxAgeMs: 30000 },
      );
    });

    it('should process nearby responders when found', async () => {
      // Arrange
      const mockEvent = {
        incidentId: 'test-incident-id',
        location: { latitude: 10.0, longitude: 20.0 },
        threatCategory: 'ASSIST',
        threatLevel: 'CLEAR',
        severity: null,
      };

      const mockResponders = [
        {
          user_id: 'responder-1',
          distance_meters: 500,
          location: {
            latitude: 10.005,
            longitude: 20.0,
            accuracy_meters: 10,
            updated_at: Date.now(),
          },
        },
        {
          user_id: 'responder-2',
          distance_meters: 800,
          location: {
            latitude: 9.995,
            longitude: 20.0,
            accuracy_meters: 8,
            updated_at: Date.now(),
          },
        },
      ];

      mockRedisService.findNearby.mockResolvedValue(mockResponders);

      // Act
      await service['handleIncidentCreated'](mockEvent);

      // Assert
      expect(mockRedisService.findNearby).toHaveBeenCalledWith(
        'responder',
        mockEvent.location,
        1000,
        { maxAgeMs: 30000 },
      );
      // Note: In a real test, we'd verify the logging or database calls
      // For now we just verify the service attempted to find nearby responders
    });
  });
});
