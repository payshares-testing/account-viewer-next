import React, { useState, useEffect } from "react";
import styled, { css } from "styled-components";
import { DataProvider } from "@stellar/wallet-sdk";
import StellarSdk, {
  Memo,
  MemoType,
  FederationServer,
  StrKey,
} from "stellar-sdk";
import BigNumber from "bignumber.js";

import { Button, ButtonVariant } from "components/basic/Button";
import { TextButton, TextButtonVariant } from "components/basic/TextButton";
import { TextLink } from "components/basic/TextLink";
import { Input } from "components/basic/Input";
import { InfoBlock, InfoBlockVariant } from "components/basic/InfoBlock";
import { Select } from "components/basic/Select";
import { ModalContent } from "components/ModalContent";

import { getNetworkConfig } from "helpers/getNetworkConfig";
import { lumensFromStroops } from "helpers/stroopConversion";
import { logEvent } from "helpers/tracking";
import { useRedux } from "hooks/useRedux";
import {
  ActionStatus,
  NetworkCongestion,
  PaymentFormData,
} from "types/types.d";
import { PALETTE } from "constants/styles";
import { knownAccounts } from "constants/knownAccounts";

const RowEl = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;

  &:not(:last-child) {
    margin-bottom: 1.5rem;
  }

  button {
    margin-top: -0.5rem;
    margin-bottom: -0.5rem;
  }
`;

const CellEl = styled.div`
  width: 100%;

  &:nth-child(2) {
    margin-top: 1.5rem;
  }

  @media (min-width: 600px) {
    width: calc(50% - 0.75rem);

    &:nth-child(2) {
      margin-top: 0;
    }
  }
`;

const CongestionEl = styled.span<{ congestion: NetworkCongestion }>`
  strong {
    ${(props) =>
      props.congestion === NetworkCongestion.LOW
        ? css`
            color: ${PALETTE.green};
          `
        : ""}

    ${(props) =>
      props.congestion === NetworkCongestion.MEDIUM
        ? css`
            color: ${PALETTE.orange};
          `
        : ""}

    ${(props) =>
      props.congestion === NetworkCongestion.HIGH
        ? css`
            color: ${PALETTE.red};
          `
        : ""}
  }
`;

const isFederationAddress = (value: string) => value.includes("*");

enum SendFormIds {
  SEND_TO = "send-to",
  SEND_AMOUNT = "send-amount",
  SEND_MEMO_TYPE = "send-memo-type",
  SEND_MEMO_CONTENT = "send-memo-content",
  SEND_FEE = "send-fee",
}

type ValidatedInput = {
  [inputId: string]: string;
};

interface CreateTransactionProps {
  initialFormData: PaymentFormData;
  maxFee: string;
  onContinue: (formData: PaymentFormData) => void;
  onCancel: () => void;
  setMaxFee: (maxFee: string) => void;
}

export const CreateTransaction = ({
  maxFee,
  initialFormData,
  onContinue,
  onCancel,
  setMaxFee,
}: CreateTransactionProps) => {
  const [formData, onInput] = useState<PaymentFormData>(initialFormData);

  const knownAccount =
    knownAccounts[formData.toAccountId] ||
    knownAccounts[formData.federationAddress || ""];
  const { account, settings } = useRedux("account", "settings");
  const [isMemoVisible, setIsMemoVisible] = useState(!!formData.memoContent);
  const [isMemoTypeFromFederation, setIsMemoTypeFromFederation] = useState(
    false,
  );
  const [
    isMemoContentFromFederation,
    setIsMemoContentFromFederation,
  ] = useState(false);
  const [
    federationAddressFetchStatus,
    setFederationAddressFetchStatus,
  ] = useState<string | null>(null);
  const [recommendedFee, setRecommendedFee] = useState(
    lumensFromStroops(StellarSdk.BASE_FEE).toString(),
  );
  const [networkCongestion, setNetworkCongestion] = useState(
    NetworkCongestion.LOW,
  );
  const [inputErrors, setInputErrors] = useState<ValidatedInput>({
    [SendFormIds.SEND_TO]: "",
    [SendFormIds.SEND_AMOUNT]: "",
    [SendFormIds.SEND_FEE]: "",
    [SendFormIds.SEND_MEMO_CONTENT]: "",
  });

  const availableBalance = new BigNumber(account.data.balances.native.total);

  useEffect(() => {
    const fetchNetworkBaseFee = async () => {
      const server = new StellarSdk.Server(
        getNetworkConfig(settings.isTestnet).url,
      );
      try {
        const feeStats = await server.feeStats();
        const networkFee = lumensFromStroops(
          feeStats.fee_charged.mode,
        ).toString();
        setRecommendedFee(networkFee);
        setMaxFee(networkFee);
        if (
          feeStats.ledger_capacity_usage > 0.5 &&
          feeStats.ledger_capacity_usage <= 0.75
        ) {
          setNetworkCongestion(NetworkCongestion.MEDIUM);
        } else if (feeStats.ledger_capacity_usage > 0.75) {
          setNetworkCongestion(NetworkCongestion.HIGH);
        }
      } catch (err) {
        // use default values
      }
    };

    fetchNetworkBaseFee();
  }, [setMaxFee, settings.isTestnet]);

  const memoPlaceholderMap: { [index: string]: string } = {
    [StellarSdk.MemoText]: "Up to 28 characters",
    [StellarSdk.MemoID]: "Unsigned 64-bit integer",
    [StellarSdk.MemoHash]:
      "32-byte hash in hexadecimal format (64 [0-9a-f] characters)",
    [StellarSdk.MemoReturn]:
      "32-byte hash in hexadecimal format (64 [0-9a-f] characters)",
    [StellarSdk.MemoNone]: "",
  };

  const fetchIfFederationAddress = async () => {
    const { toAccountId } = formData;

    if (isFederationAddress(toAccountId)) {
      setFederationAddressFetchStatus(ActionStatus.PENDING);

      try {
        const response = await FederationServer.resolve(toAccountId);
        setFederationAddressFetchStatus(ActionStatus.SUCCESS);

        if (response.memo || response.memo_type) {
          setIsMemoVisible(true);
          if (response.memo_type) {
            setIsMemoTypeFromFederation(true);
          }
          if (response.memo) {
            setIsMemoContentFromFederation(true);
          }

          onInput({
            ...formData,
            federationAddress: response.account_id,
            memoType: response.memo_type || StellarSdk.MemoText,
            memoContent: response.memo || "",
          });
        } else {
          onInput({
            ...formData,
            federationAddress: response.account_id,
          });
        }
      } catch (err) {
        setFederationAddressFetchStatus(ActionStatus.ERROR);
      }
    } else {
      resetFederationAddressInput();
    }
  };

  const checkIfAccountIsFunded = async () => {
    const { toAccountId } = formData;

    if (!toAccountId || !StrKey.isValidEd25519PublicKey(toAccountId)) {
      onInput({
        ...formData,
        isAccountFunded: true,
      });
      return;
    }

    const dataProvider = new DataProvider({
      serverUrl: getNetworkConfig(settings.isTestnet).url,
      accountOrKey: toAccountId,
      networkPassphrase: getNetworkConfig(settings.isTestnet).network,
    });

    onInput({
      ...formData,
      isAccountFunded: await dataProvider.isAccountFunded(),
    });
  };

  const resetFederationAddressInput = () => {
    setFederationAddressFetchStatus(null);
    onInput({ ...formData, federationAddress: undefined });
  };

  const validateInput = (inputId: string) => {
    const errors: ValidatedInput = {};
    let message = "";
    const memoContent = formData.memoContent as string;

    switch (inputId) {
      case SendFormIds.SEND_TO:
        if (!formData.toAccountId) {
          message = "Please enter a valid Stellar or Federated address";
        } else if (
          !isFederationAddress(formData.toAccountId) &&
          !StrKey.isValidEd25519PublicKey(formData.toAccountId)
        ) {
          message =
            'Stellar address or public key is invalid. Public keys are uppercase and begin with letter "G."';
        }

        errors[SendFormIds.SEND_TO] = message;
        if (message) {
          logEvent("send: saw invalid destination address error");
        }
        break;
      case SendFormIds.SEND_AMOUNT:
        if (!formData.amount) {
          message = "Please enter amount";
        } else if (new BigNumber(formData.amount).lte(0)) {
          message = "Amount must be larger than 0";
        } else if (new BigNumber(formData.amount).gt(availableBalance)) {
          message = "This amount is larger than your balance";
        } else if (
          !formData.isAccountFunded &&
          new BigNumber(formData.amount).lt(1)
        ) {
          message = "Send at least 1 lumen to create this account";
        }

        errors[SendFormIds.SEND_AMOUNT] = message;
        if (message) {
          logEvent("send: saw invalid amount error");
        }
        break;
      case SendFormIds.SEND_FEE:
        // recommendedFee is minimum fee
        if (!maxFee) {
          message = "Please enter fee";
        } else if (new BigNumber(maxFee).lt(recommendedFee)) {
          message = `Fee is too small. Minimum fee is ${recommendedFee}.`;
        }

        errors[SendFormIds.SEND_FEE] = message;
        if (message) {
          logEvent("send: saw fee too small error");
        }
        break;
      case SendFormIds.SEND_MEMO_CONTENT:
        if (isMemoVisible) {
          if (!memoContent) {
            message = "Please enter memo content";
          }

          let memoMessage = "";

          try {
            switch (formData.memoType) {
              case StellarSdk.MemoText:
                memoMessage =
                  "MEMO_TEXT must contain a maximum of 28 characters";
                Memo.text(memoContent);
                break;
              case StellarSdk.MemoID:
                memoMessage = "MEMO_ID must be a valid 64 bit unsigned integer";
                Memo.id(memoContent);
                break;
              case StellarSdk.MemoHash:
                memoMessage =
                  "MEMO_HASH must be a 32 byte hash represented in hexadecimal (A-Z0-9)";
                Memo.hash(memoContent);
                break;
              case StellarSdk.MemoReturn:
                memoMessage =
                  "MEMO_RETURN must be a 32 byte hash represented in hexadecimal (A-Z0-9)";
                Memo.return(memoContent);
                break;
              default:
                break;
            }
          } catch (error) {
            message = memoMessage;
          }
        }

        errors[SendFormIds.SEND_MEMO_CONTENT] = message;

        break;
      default:
        break;
    }

    return errors;
  };

  const validate = (event: React.FocusEvent<HTMLInputElement>) => {
    setInputErrors({ ...inputErrors, ...validateInput(event.target.id) });
  };

  const clearInputError = (inputId: string) => {
    setInputErrors({ ...inputErrors, [inputId]: "" });
  };

  const onSubmit = () => {
    let errors = {};
    let hasErrors = false;

    // Loop through inputs we need to validate
    Object.keys(inputErrors).forEach((inputId) => {
      errors = { ...errors, ...validateInput(inputId) };

      // Check if input has error message
      if (!hasErrors && validateInput(inputId)[inputId]) {
        hasErrors = true;
      }
    });

    if (hasErrors) {
      setInputErrors(errors);
    } else {
      onContinue(formData);
    }
  };

  return (
    <ModalContent
      headlineText="Send Lumens"
      buttonFooter={
        <>
          <Button onClick={onSubmit}>Continue</Button>
          <Button onClick={onCancel} variant={ButtonVariant.secondary}>
            Cancel
          </Button>
        </>
      }
    >
      <RowEl>
        <Input
          id={SendFormIds.SEND_TO}
          label="Sending To"
          type="text"
          onChange={(e) => {
            let newFormData = { ...formData, toAccountId: e.target.value };

            clearInputError(e.target.id);

            if (federationAddressFetchStatus) {
              setFederationAddressFetchStatus(null);
            }

            // Reset memo whenever a new known account is found.
            if (knownAccounts[e.target.value]) {
              newFormData = {
                ...newFormData,
                memoType: StellarSdk.MemoText,
                memoContent: null,
              };
            }

            // Reset federation fields whenever the address change.
            if (isMemoTypeFromFederation || isMemoContentFromFederation) {
              setIsMemoTypeFromFederation(false);
              setIsMemoContentFromFederation(false);
            }

            onInput(newFormData);
          }}
          onBlur={(e) => {
            validate(e);
            fetchIfFederationAddress();
            checkIfAccountIsFunded();
          }}
          error={inputErrors[SendFormIds.SEND_TO]}
          defaultValue={formData.toAccountId}
          placeholder="Recipient's public key or federation address"
        />
      </RowEl>

      {federationAddressFetchStatus && (
        <RowEl>
          <InfoBlock
            variant={
              federationAddressFetchStatus === ActionStatus.ERROR
                ? InfoBlockVariant.error
                : InfoBlockVariant.info
            }
          >
            {federationAddressFetchStatus === ActionStatus.PENDING && (
              <p>Loading federation address…</p>
            )}

            {federationAddressFetchStatus === ActionStatus.SUCCESS && (
              <>
                <p>
                  Federation Address: {formData.toAccountId}
                  <br />
                  Resolves to: {formData.federationAddress}
                </p>
              </>
            )}

            {federationAddressFetchStatus === ActionStatus.ERROR && (
              <p>Federation Address not found</p>
            )}
          </InfoBlock>
        </RowEl>
      )}

      <RowEl>
        <CellEl>
          <Input
            id={SendFormIds.SEND_AMOUNT}
            label="Amount"
            rightElement="lumens"
            type="number"
            onChange={(e) => {
              clearInputError(e.target.id);

              onInput({
                ...formData,
                amount: e.target.value,
              });
            }}
            onBlur={validate}
            error={inputErrors[SendFormIds.SEND_AMOUNT]}
            defaultValue={formData.amount.toString()}
            placeholder="Amount to send"
          />
        </CellEl>
      </RowEl>

      {Boolean(knownAccount) && (
        <RowEl>
          <InfoBlock variant={InfoBlockVariant.warning}>
            <p>
              The payment destination ({knownAccount.name}) requires you to
              specify a memo to identify your account.
            </p>
          </InfoBlock>
        </RowEl>
      )}

      {!isMemoVisible && !knownAccount && (
        <RowEl>
          <TextButton
            variant={TextButtonVariant.secondary}
            onClick={() => {
              onInput({ ...formData, memoType: StellarSdk.MemoText });
              setIsMemoVisible(true);
            }}
          >
            Add memo
          </TextButton>
        </RowEl>
      )}

      {Boolean(isMemoVisible || knownAccount) && (
        <>
          <RowEl>
            <CellEl>
              <Select
                id={SendFormIds.SEND_MEMO_TYPE}
                label="Memo Type"
                onChange={(e) => {
                  clearInputError(e.target.id);

                  onInput({
                    ...formData,
                    memoType: e.target.value as MemoType,
                  });
                }}
                defaultValue={formData.memoType}
                disabled={isMemoTypeFromFederation}
              >
                <option value={StellarSdk.MemoText}>MEMO_TEXT</option>
                <option value={StellarSdk.MemoID}>MEMO_ID</option>
                <option value={StellarSdk.MemoHash}>MEMO_HASH</option>
                <option value={StellarSdk.MemoReturn}>MEMO_RETURN</option>
              </Select>
            </CellEl>

            <CellEl>
              <Input
                id={SendFormIds.SEND_MEMO_CONTENT}
                label="Memo content"
                type="text"
                placeholder={
                  memoPlaceholderMap[formData.memoType || StellarSdk.MemoNone]
                }
                onChange={(e) => {
                  clearInputError(e.target.id);

                  onInput({
                    ...formData,
                    memoContent: e.target.value,
                  });
                }}
                onBlur={validate}
                defaultValue={formData.memoContent as string}
                disabled={isMemoContentFromFederation}
                error={inputErrors[SendFormIds.SEND_MEMO_CONTENT]}
              />
            </CellEl>
          </RowEl>

          {(isMemoContentFromFederation || isMemoTypeFromFederation) && (
            <RowEl>
              <InfoBlock>
                Memo information is provided by the federation address
              </InfoBlock>
            </RowEl>
          )}

          {!isMemoContentFromFederation && (
            <RowEl>
              <TextButton
                variant={TextButtonVariant.secondary}
                onClick={() => {
                  clearInputError(SendFormIds.SEND_MEMO_CONTENT);
                  onInput({
                    ...formData,
                    memoType: StellarSdk.MemoNone,
                    memoContent: "",
                  });
                  setIsMemoVisible(false);
                }}
              >
                Remove memo
              </TextButton>
            </RowEl>
          )}
        </>
      )}

      <RowEl>
        <CellEl>
          <Input
            id={SendFormIds.SEND_FEE}
            label="Fee"
            rightElement="lumens"
            type="number"
            defaultValue={maxFee}
            onChange={(e) => {
              clearInputError(e.target.id);
              setMaxFee(e.target.value);
            }}
            onBlur={validate}
            error={inputErrors[SendFormIds.SEND_FEE]}
            note={
              <CongestionEl congestion={networkCongestion}>
                <strong>{networkCongestion} congestion!</strong> Recommended
                fee: {recommendedFee}.
              </CongestionEl>
            }
          />
        </CellEl>
      </RowEl>

      {!formData.isAccountFunded && (
        <RowEl>
          <InfoBlock>
            The destination account doesn’t exist. A create account operation
            will be used to create this account.{" "}
            <TextLink
              href="https://developers.stellar.org/docs/tutorials/create-account/"
              target="_blank"
              rel="noreferrer"
            >
              Learn more about account creation
            </TextLink>
          </InfoBlock>
        </RowEl>
      )}
    </ModalContent>
  );
};
