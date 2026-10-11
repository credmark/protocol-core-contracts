import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { MockCMK, RewardsPool, StakedCredmark } from '../typechain-types';

describe('Staked Credmark', () => {
  let cmk: MockCMK;
  let stakedCmk: StakedCredmark;
  let wallet: SignerWithAddress;
  let secondWallet: SignerWithAddress;
  let thirdWallet: SignerWithAddress;
  let fourthWallet: SignerWithAddress;

  const sevenDays = 7 * 24 * 60 * 60;

  const fixture = async (): Promise<[MockCMK, StakedCredmark]> => {
    const mockCmkFactory = await ethers.getContractFactory('MockCMK');
    const _cmk = (await mockCmkFactory.deploy()) as MockCMK;

    const stakedCmkFactory = await ethers.getContractFactory('StakedCredmark');
    const _stakedCmk = (await stakedCmkFactory.deploy(
      await _cmk.getAddress()
    )) as StakedCredmark;

    return [_cmk, _stakedCmk];
  };

  beforeEach(async () => {
    [cmk, stakedCmk] = await loadFixture(fixture);
    [wallet, secondWallet, thirdWallet, fourthWallet] =
      await ethers.getSigners();
  });

  describe('#cmkSupply', () => {
    it('should assign initial cmk supply', async () => {
      await cmk.transfer(await stakedCmk.getAddress(), 1000);
      expect(await stakedCmk.cmkBalance()).to.equal(BigInt(1000));
    });

    it('should increase xCMK value on CMK infusion', async () => {
      await cmk.approve(await stakedCmk.getAddress(), 100);
      await stakedCmk.createShare(100);
      const beforeInfusionValue = await stakedCmk.sharesToCmk(1);
      await cmk.transfer(await stakedCmk.getAddress(), 1000);
      const afterInfusionValue = await stakedCmk.sharesToCmk(1);

      expect(afterInfusionValue).to.be.gt(beforeInfusionValue);
    });
  });

  describe('#createShare', () => {
    it('should create share', async () => {
      await cmk.approve(await stakedCmk.getAddress(), 100);
      await stakedCmk.createShare(100);
      expect(await stakedCmk.balanceOf(await wallet.getAddress())).to.equal(
        BigInt(100)
      );
      expect(await stakedCmk.totalSupply()).to.equal(BigInt(100));
    });

    it('should not create share if low cmk balance', async () => {
      await cmk
        .connect(secondWallet)
        .approve(await stakedCmk.getAddress(), 100);
      await expect(stakedCmk.connect(secondWallet).createShare(100)).to.be
        .reverted;
    });
  });

  describe('#removeShare', () => {
    it('should remove share', async () => {
      await cmk.approve(await stakedCmk.getAddress(), 100);
      await stakedCmk.createShare(100);

      const cmkBalance = await cmk.balanceOf(await wallet.getAddress());
      await stakedCmk.removeShare(100);
      expect(await stakedCmk.balanceOf(await wallet.getAddress())).to.equal(
        BigInt(0)
      );
      expect(await stakedCmk.totalSupply()).to.equal(BigInt(0));
      expect(await cmk.balanceOf(await wallet.getAddress())).to.be.equal(
        cmkBalance + 100n
      );
    });

    it('should not remove share if low share balance', async () => {
      await expect(stakedCmk.removeShare(100)).to.be.reverted;
    });

    it('should issue rewards on removing share', async () => {
      const rewardsPoolFactory = await ethers.getContractFactory('RewardsPool');
      const rewardsPool = (await rewardsPoolFactory.deploy(
        await cmk.getAddress(),
        await stakedCmk.getAddress()
      )) as RewardsPool;
      await stakedCmk.setRewardsPool(await rewardsPool.getAddress());

      await cmk.transfer(await rewardsPool.getAddress(), 10000000);

      const bn = await ethers.provider.getBlockNumber();
      const blk = await ethers.provider.getBlock(bn);
      const now = BigInt(blk.timestamp);
      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));

      await cmk.approve(await stakedCmk.getAddress(), 1000);
      await stakedCmk.createShare(1000);

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      const unissuedRewards = await rewardsPool.unissuedRewards();
      expect(unissuedRewards).to.be.closeTo(BigInt(5000000), 100);

      await expect(stakedCmk.removeShare(1000)).to.emit(
        rewardsPool,
        'RewardsIssued'
      );
    });

    it('should issue rewards once every 8 hours', async () => {
      const rewardsPoolFactory = await ethers.getContractFactory('RewardsPool');
      const rewardsPool = (await rewardsPoolFactory.deploy(
        await cmk.getAddress(),
        await stakedCmk.getAddress()
      )) as RewardsPool;
      await stakedCmk.setRewardsPool(await rewardsPool.getAddress());

      await cmk.transfer(await rewardsPool.getAddress(), 10000000);

      const bn = await ethers.provider.getBlockNumber();
      const blk = await ethers.provider.getBlock(bn);
      const now = BigInt(blk.timestamp);
      await rewardsPool.start(now + BigInt(sevenDays) + BigInt(sevenDays));

      await cmk.approve(await stakedCmk.getAddress(), 1000);
      await stakedCmk.createShare(1000);

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      await expect(stakedCmk.removeShare(100)).to.emit(
        rewardsPool,
        'RewardsIssued'
      );
      await expect(stakedCmk.removeShare(100)).to.not.emit(
        rewardsPool,
        'RewardsIssued'
      );

      await ethers.provider.send('evm_increaseTime', [8 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
      await expect(stakedCmk.removeShare(100)).to.emit(
        rewardsPool,
        'RewardsIssued'
      );
    });
  });

  describe('#complexMath', () => {
    it('should have perfect CMK->xCMK and xCMK->CMK conversion for multiple wallets', async () => {
      const rewardsPoolFactory = await ethers.getContractFactory('RewardsPool');
      const rewardsPool = (await rewardsPoolFactory.deploy(
        await cmk.getAddress(),
        await stakedCmk.getAddress()
      )) as RewardsPool;
      await stakedCmk.setRewardsPool(await rewardsPool.getAddress());

      /**
       * Stage 1 starts
       * Rewards pool with 100_000 for 1 week
       * Since no rewards have been issued, CKM is equivalent to xCMK
       *
       * In this stage 4 wallets, creates some xCMK shares
       */
      await cmk.transfer(await rewardsPool.getAddress(), 100_000);

      const bn = await ethers.provider.getBlockNumber();
      const blk = await ethers.provider.getBlock(bn);
      const now = BigInt(blk.timestamp);
      await rewardsPool.start(now + (BigInt(sevenDays)));

      await cmk.transfer(await secondWallet.getAddress(), 10_000_000);
      await cmk.transfer(await thirdWallet.getAddress(), 10_000_000);
      await cmk.transfer(await fourthWallet.getAddress(), 10_000_000);

      await cmk.approve(await stakedCmk.getAddress(), 10_000_000);
      await cmk.connect(secondWallet).approve(await stakedCmk.getAddress(), 10_000_000);
      await cmk.connect(thirdWallet).approve(await stakedCmk.getAddress(), 10_000_000);
      await cmk.connect(fourthWallet).approve(await stakedCmk.getAddress(), 10_000_000);

      // Before any issue of rewards, xCMK should be equivalent to cmk
      await stakedCmk.createShare(1_000_000);
      expect(await stakedCmk.balanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(1_000_000)
      );
      expect(await stakedCmk.cmkBalanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(1_000_000)
      );
      expect(await stakedCmk.sharesToCmk(1_000_000)).to.be.equal(
        BigInt(1_000_000)
      );

      await stakedCmk.connect(secondWallet).createShare(500_000);
      expect(await stakedCmk.balanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(500_000)
      );
      expect(await stakedCmk.cmkBalanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(500_000)
      );
      expect(await stakedCmk.sharesToCmk(1_000_000)).to.be.equal(
        BigInt(1_000_000)
      );

      await stakedCmk.connect(thirdWallet).createShare(400_000);
      expect(await stakedCmk.balanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(400_000)
      );
      expect(await stakedCmk.cmkBalanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(400_000)
      );
      expect(await stakedCmk.sharesToCmk(1_000_000)).to.be.equal(
        BigInt(1_000_000)
      );

      await stakedCmk.connect(fourthWallet).createShare(100_000);
      expect(await stakedCmk.balanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(100_000)
      );
      expect(await stakedCmk.cmkBalanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(100_000)
      );
      expect(await stakedCmk.sharesToCmk(1_000_000)).to.be.equal(
        BigInt(1_000_000)
      );

      /**
       * Stage 1 ends
       *
       * All of the 100_000 reward is issued after 7 days, changing total CMK to 2.1M
       * Now 2_100_000 CMK is equivalent to 2_000_000 xCMK, that makes xCMK to be 1.05x CMK
       */

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      await rewardsPool.issueRewards();
      expect(await stakedCmk.sharesToCmk(1_000_000)).to.be.equal(
        BigInt(1_050_000)
      ); // 1M * 1.05 CMK

      // Checking if equivalent reward is distributed among wallets
      // walletReward = cmkRewarded * (xCMKBalance / xCMKTotalSupply)
      expect(await stakedCmk.cmkBalanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(1_000_000 + 50_000)
      ); // 100_000 * (1_000_000 / 2_000_000)
      expect(await stakedCmk.cmkBalanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(500_000 + 25_000)
      ); // 100_000 * (500_000 / 2_000_000)
      expect(await stakedCmk.cmkBalanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(400_000 + 20_000)
      ); // 100_000 * (400_000 / 2_000_000)
      expect(await stakedCmk.cmkBalanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(100_000 + 5_000)
      ); // 100_000 * (100_000 / 2_000_000)

      /**
       * Stage 2 starts
       * Rewards pool now reset with 1_000_000 for 1 week
       *
       * In this stage, 2 wallets removes some shares and 2 wallets adds some shares
       */
      const bn2 = await ethers.provider.getBlockNumber();
      const blk2 = await ethers.provider.getBlock(bn2);
      const now2 = BigInt(blk2.timestamp);
      await rewardsPool.setEndTime(now2 + (BigInt(sevenDays)));
      await cmk.transfer(await rewardsPool.getAddress(), 1_000_000);

      // Wallet 1
      // Removing 0.5M shares returns 0.525M CMK
      await expect(stakedCmk.removeShare(500_000))
        .to.emit(cmk, 'Transfer')
        .withArgs(await stakedCmk.getAddress(), await wallet.getAddress(), BigInt(525_000)); // 0.5M * 1.05 CMK
      expect(await stakedCmk.cmkBalanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(525_000)
      ); // 1.05M - 0.525M CMK
      expect(await stakedCmk.balanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(500_000)
      ); // 1M - 0.5M xCMK
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(1_575_000)
      ); // 2.1M - 0.525M CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(1_500_000)
      ); // 2M - 0.5M xCMK

      // Wallet 2
      // Removing 0.4M shares returns 0.42M CMK
      await expect(stakedCmk.connect(secondWallet).removeShare(400_000))
        .to.emit(cmk, 'Transfer')
        .withArgs(
          await stakedCmk.getAddress(),
          await secondWallet.getAddress(),
          BigInt(420_000)
        ); // 400k * 1.05 CMK
      expect(await stakedCmk.cmkBalanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(105_000)
      ); // 525k - 420k CMK
      expect(await stakedCmk.balanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(100_000)
      ); // 500k - 400k xCMK
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(1_155_000)
      ); // 1.575M - 0.42M CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(1_100_000)
      ); // 1.5M - 0.4M xCMK

      // Wallet 3
      // Creating shares worth 630k CMK will mint 600k xCMK
      await expect(stakedCmk.connect(thirdWallet).createShare(630_000))
        .to.emit(stakedCmk, 'Transfer')
        .withArgs(
          '0x0000000000000000000000000000000000000000',
          await thirdWallet.getAddress(),
          BigInt(600_000)
        ); // 630_000 / 1.05
      expect(await stakedCmk.cmkBalanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(1_050_000)
      ); // 420k + 630k CMK
      expect(await stakedCmk.balanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(1_000_000)
      ); // 400k + 600k xCMK
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(1_785_000)
      ); // 1.155M + 0.63M CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(1_700_000)
      ); // 1.1M + 0.6M xCMK

      // Wallet 4
      // Creating shares worth 84k CMK will mint 80k xCMK
      await expect(stakedCmk.connect(fourthWallet).createShare(84_000))
        .to.emit(stakedCmk, 'Transfer')
        .withArgs(
          '0x0000000000000000000000000000000000000000',
          await fourthWallet.getAddress(),
          BigInt(80_000)
        ); // 84_000 / 1.05
      expect(await stakedCmk.cmkBalanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(189_000)
      ); // 105k + 84k CMK
      expect(await stakedCmk.balanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(180_000)
      ); // 100k + 80k xCMK
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(1_869_000)
      ); // 1.785M + 0.084M CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(1_780_000)
      ); // 1.7M + 0.08M xCMK

      /**
       * Stage 2 ends
       *
       * All of the 1_000_000 reward will be issued after 7 days, changing total cmk balance to 2_869_000
       * Now 2_869_000 CMK is equivalent to 1_780_000 xCMK, that makes xCMK to be ~1.61x CMK
       */

      await ethers.provider.send('evm_increaseTime', [sevenDays]);
      await ethers.provider.send('evm_mine', []);

      await rewardsPool.issueRewards();
      expect(await stakedCmk.sharesToCmk(1_000_000)).to.be.equal(
        BigInt(1_611_797)
      ); // ~ 1M * 1.61 CMK

      // Checking if equivalent reward is distributed among wallets
      // walletReward = cmkRewarded * (xCMKBalance / xCMKTotalSupply)
      expect(await stakedCmk.cmkBalanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(525_000) + BigInt(280_898)
      ); // 1_000_000 * (500_000 / 1_780_000)
      expect(await stakedCmk.cmkBalanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(105_000) + BigInt(56_179)
      ); // 1_000_000 * (100_000 / 1_780_000)
      expect(await stakedCmk.cmkBalanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(1_050_000) + BigInt(561_797)
      ); // 1_000_000 * (1_000_000 / 1_780_000)
      expect(await stakedCmk.cmkBalanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(189_000) + BigInt(101_123)
      ); // 1_000_000 * (180_000 / 1_780_000)

      /**
       * Stage 3 starts
       * Not resetting rewards pool anymore
       * In this stage, 4 wallets will remove their remaining shares
       */

      // Wallet 1
      // Removing all 500_000 shares
      await expect(stakedCmk.removeShare(500_000))
        .to.emit(cmk, 'Transfer')
        .withArgs(await stakedCmk.getAddress(), await wallet.getAddress(), BigInt(805_898)); // 500_000 * (2_869_000 / 1_780_000)
      expect(await stakedCmk.cmkBalanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      expect(await stakedCmk.balanceOf(await wallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(2_063_102)
      ); // 2_869_000 - 805_898 CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(1_280_000)
      ); // 1.78M - 0.5M xCMK

      // Wallet 2
      // Removing all 500_000 shares
      await expect(stakedCmk.connect(secondWallet).removeShare(100_000))
        .to.emit(cmk, 'Transfer')
        .withArgs(
          await stakedCmk.getAddress(),
          await secondWallet.getAddress(),
          BigInt(161_179)
        ); // 100_000 * (2_063_102 / 1_280_000)
      expect(await stakedCmk.cmkBalanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      expect(await stakedCmk.balanceOf(await secondWallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(1_901_923)
      ); // 2_063_102 - 161_179 CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(1_180_000)
      ); // 1.28M - 0.1M xCMK

      // Wallet 3
      // Removing all 1_000_000 shares
      await expect(stakedCmk.connect(thirdWallet).removeShare(1_000_000))
        .to.emit(cmk, 'Transfer')
        .withArgs(
          await stakedCmk.getAddress(),
          await thirdWallet.getAddress(),
          BigInt(1_611_799)
        ); // 1_000_000 * (1_901_923 / 1_180_000)
      expect(await stakedCmk.cmkBalanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      expect(await stakedCmk.balanceOf(await thirdWallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(290_124)
      ); // 1_901_923 - 1_611_799 CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(
        BigInt(180_000)
      ); // 1.18M - 1M xCMK

      // Wallet 4
      // Removing all 1_000_000 shares
      await expect(stakedCmk.connect(fourthWallet).removeShare(180_000))
        .to.emit(cmk, 'Transfer')
        .withArgs(
          await stakedCmk.getAddress(),
          await fourthWallet.getAddress(),
          BigInt(290_124)
        ); // 1_000_000 * (1_901_923 / 1_180_000)
      expect(await stakedCmk.cmkBalanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      expect(await stakedCmk.balanceOf(await fourthWallet.getAddress())).to.be.equal(
        BigInt(0)
      );
      // Staked Credmark
      expect(await cmk.balanceOf(await stakedCmk.getAddress())).to.be.equal(
        BigInt(0)
      ); // 290_124 - 290_124 CMK
      expect(await stakedCmk.totalSupply()).to.be.equal(BigInt(0)); // 0.18M - 0.18M xCMK

      /**
       * Stage 3 ends
       * Staked CMK contract is now empty
       */
    });
  });
});
