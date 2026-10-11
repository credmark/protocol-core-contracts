import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { MockCMK, StakedCredmark, RewardsPool } from '../typechain-types';

describe('Rewards Pool', () => {
  let cmk: MockCMK;
  let stakedCmk: StakedCredmark;
  let rewardsPool: RewardsPool;
  let wallet: SignerWithAddress;
  let otherWallet: SignerWithAddress;
  let now = BigInt(Date.now()) / 1000n;

  const sevenDays = 7 * 24 * 60 * 60;

  const fixture = async (): Promise<[MockCMK, StakedCredmark, RewardsPool]> => {
    const mockCmkFactory = await ethers.getContractFactory('MockCMK');
    const _cmk = (await mockCmkFactory.deploy()) as MockCMK;

    const stakedCmkFactory = await ethers.getContractFactory('StakedCredmark');
    const _stakedCmk = (await stakedCmkFactory.deploy(
      await _cmk.getAddress()
    )) as StakedCredmark;

    const rewardsPoolFactory = await ethers.getContractFactory('RewardsPool');
    const _rewardsPool = (await rewardsPoolFactory.deploy(
      await _cmk.getAddress(),
      await _stakedCmk.getAddress()
    )) as RewardsPool;

    await _stakedCmk.setRewardsPool(await _rewardsPool.getAddress());

    return [_cmk, _stakedCmk, _rewardsPool];
  };

  beforeEach(async () => {
    [cmk, stakedCmk, rewardsPool] = await loadFixture(fixture);
    [wallet, otherWallet] = await ethers.getSigners();

    /**
     * Since rewards pool is time based, manually changing block time, to validate
     * such calculations.
     */
    now = now + BigInt(sevenDays * 4);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(now)]);
    await ethers.provider.send('evm_mine', []);
  });

  describe('#start', () => {
    it('should not be started by non owner', async () => {
      const otherRewardsPool = rewardsPool.connect(otherWallet);
      await expect(otherRewardsPool.start(0)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('should not be started with end time in past', async () => {
      await expect(
        rewardsPool.start(BigInt(Date.now()) / 1000n - BigInt(sevenDays))
      ).to.be.revertedWith('End time is not in future');
    });

    it('should not issue rewards when not started', async () => {
      await expect(rewardsPool.issueRewards()).to.be.revertedWith(
        'Pool has not started'
      );
    });

    it('should be started by owner', async () => {
      await rewardsPool.start(now + BigInt(sevenDays));
      expect(await rewardsPool.started()).to.equal(true);
    });

    it('should not restart', async () => {
      await rewardsPool.start(now + BigInt(sevenDays));
      await expect(rewardsPool.start(now + BigInt(sevenDays))).to.be.revertedWith(
        'Contract Already Started'
      );
    });
  });

  describe('#endTime', () => {
    it('should allow owner to set end time', async () => {
      await rewardsPool.start(now + BigInt(sevenDays));
      await rewardsPool.setEndTime(now + BigInt(sevenDays));
    });

    it('should not allow non-owner to set end time', async () => {
      await rewardsPool.start(now + BigInt(sevenDays));
      const otherRewardsPool = rewardsPool.connect(otherWallet);
      await expect(
        otherRewardsPool.setEndTime(now + BigInt(sevenDays))
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should not allow to set end time in the past', async () => {
      await rewardsPool.start(now + BigInt(sevenDays));
      await expect(
        rewardsPool.setEndTime(
          BigInt(Date.now()) / 1000n - BigInt(sevenDays)
        )
      ).to.be.revertedWith('End time is not in future');
    });
  });

  describe('#unissuedRewards', () => {
    it('should increase unissued rewards with time', async () => {
      await cmk.transfer(await rewardsPool.getAddress(), 10000000);

      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));
      const unissuedRewardsBefore = await rewardsPool.unissuedRewards();

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewardsAfter = await rewardsPool.unissuedRewards();
      expect(unissuedRewardsAfter - (unissuedRewardsBefore)).to.be.closeTo(
        BigInt(5000000),
        100
      );
    });
  });

  describe('#issueRewards', () => {
    it('should issue rewards to staked cmk', async () => {
      await cmk.transfer(await rewardsPool.getAddress(), 10000000);

      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewards = await rewardsPool.unissuedRewards();
      expect(unissuedRewards).to.be.closeTo(BigInt(5000000), 100);

      await expect(rewardsPool.issueRewards()).to.emit(
        rewardsPool,
        'RewardsIssued'
      );
      expect(await cmk.balanceOf(await rewardsPool.getAddress())).to.be.closeTo(
        BigInt(10000000) - (unissuedRewards),
        100
      );
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.closeTo(
        unissuedRewards,
        100
      );
    });

    it('should not emit event when no unissued rewards', async () => {
      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewards = await rewardsPool.unissuedRewards();
      expect(unissuedRewards).to.be.equal(BigInt(0));

      await expect(rewardsPool.issueRewards()).to.not.emit(
        rewardsPool,
        'RewardsIssued'
      );
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(0)
      );
    });

    it('should issue rewards proportional to time passed', async () => {
      await cmk.transfer(await rewardsPool.getAddress(), 10000000);

      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));

      /**
       * After 7 days (at halfway), half should be exhausted
       */
      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewards = await rewardsPool.unissuedRewards();
      expect(unissuedRewards).to.be.closeTo(BigInt(5000000), 100);

      await expect(rewardsPool.issueRewards()).to.emit(
        rewardsPool,
        'RewardsIssued'
      );
      expect(await cmk.balanceOf(await rewardsPool.getAddress())).to.be.closeTo(
        BigInt(10000000) - (unissuedRewards),
        100
      );
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.closeTo(
        unissuedRewards,
        100
      );

      /**
       * After 14 more days (at end time), everything should be exhausted
       */
      await ethers.provider.send('evm_increaseTime', [sevenDays * 2]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewards2 = await rewardsPool.unissuedRewards();
      expect(unissuedRewards2).to.be.closeTo(BigInt(5000000), 100);

      await expect(rewardsPool.issueRewards()).to.emit(
        rewardsPool,
        'RewardsIssued'
      );
      expect(await cmk.balanceOf(await rewardsPool.getAddress())).to.be.equal(
        BigInt(0)
      );
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(10000000)
      );

      /**
       * Now no rewards should be issued
       */
      const unissuedRewards3 = await rewardsPool.unissuedRewards();
      expect(unissuedRewards3).to.be.equal(BigInt(0));

      await expect(rewardsPool.issueRewards()).to.not.emit(
        rewardsPool,
        'RewardsIssued'
      );
    });

    it('should issue rewards on updating end time', async () => {
      await cmk.transfer(await rewardsPool.getAddress(), 10000000);

      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewards = await rewardsPool.unissuedRewards();
      expect(unissuedRewards).to.be.closeTo(BigInt(5000000), 100);

      await expect(
        rewardsPool.setEndTime(now + BigInt(sevenDays) + BigInt(sevenDays * 2))
      ).to.emit(rewardsPool, 'RewardsIssued');

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);
      const unissuedRewards2 = await rewardsPool.unissuedRewards();
      expect(unissuedRewards2).to.be.closeTo(BigInt(2500000), 100);
    });
  });
});
